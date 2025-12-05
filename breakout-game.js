// TripGeo.Client/wwwroot/geobox-assets/games/tankofduty/tankofduty-game.js
// Game logic for Tank of Duty with WebRTC peer-to-peer synchronization
//
// Reworked to load GeoJSON building polygons from:
//   https://mapsmania.github.io/globalbuilding/building.geojson
//
// Features added:
// - Host fetches & simplifies polygons, builds spatial index, broadcasts map
// - Clients receive map and build their spatial index
// - Polygon-circle collision for tanks & projectiles
// - Projectile reflection against nearest polygon edge
// - Dynamic nearby-building queries for rendering & collision (grid index)
// - No external libraries required

export class TankGame
{
    constructor(options, renderer, sendMessageFn, broadcastMessageFn, soundManager)
    {
        this.options = options;
        this.renderer = renderer;
        this.sendMessage = sendMessageFn;
        this.broadcastMessage = broadcastMessageFn;
        this.soundManager = soundManager; 

        this.myUserId = options.myUserId;
        this.isHost = options.isHost;
        this.isSinglePlayer = options.isSinglePlayer;

        this.players = new Map();
        this.projectiles = new Map();
        this.buildings = [];          // array of { id, type:'polygon', points:[{x,y}], bbox:{minX,minY,maxX,maxY}, color }
        this._gridIndex = null;       // spatial index (initialized after buildings are loaded)
        this._gridCellSize = 320;     // world units (tweak for perf/detail)

        this.localInput = {
            forward: 0,
            turn: 0,
            turretAngle: 0,
            firing: false,
            seq: 0
        };

        this.lastInputSent = 0;
        this.gameOverState = null;
        this.explosions = []; // Track active explosions

        // 3x3 screen area (roughly 5760 x 3240 for 1920x1080 screens)
        this.world = { width: 5760, height: 3240 };

        // Tank colors
        this.colours = [
            '#0ff', '#f0f', '#ff0', '#0f0',
            '#fa0', '#0af', '#f8a', '#8f8'
        ];

        // Host generates (loads) the map and broadcasts it
        if (this.isHost)
        {
            // Async load - host loads GeoJSON, simplifies & builds index, then broadcasts
            this.initBuildingsFromGeoJson().then(() =>
            {
                if (!this.isSinglePlayer)
                {
                    // Broadcast map to all players (send simplified polygons)
                    // NOTE: serializing polygon points across network — reasonably sized after simplification
                    setTimeout(() =>
                    {
                        this.broadcastMessage('tank-map-init', {
                            buildings: this.buildings,
                            worldSize: this.world
                        });
                    }, 50);
                }
            }).catch(err =>
            {
                console.error('[TankGame] Error loading GeoJSON buildings:', err);
                // Fallback to procedural grid if loading fails
                this.initBuildings(); // your original generator (keeps backwards compat)
                if (!this.isSinglePlayer)
                {
                    setTimeout(() =>
                    {
                        this.broadcastMessage('tank-map-init', {
                            buildings: this.buildings,
                            worldSize: this.world
                        });
                    }, 50);
                }
            });
        }

        this.initPlayers();
        this.setupInputHandlers();

        console.log('[TankGame] Initialized', { isHost: this.isHost, players: this.players.size });
    }

    // ---------------------------
    // NEW: Host-side GeoJSON loader
    // ---------------------------
    async initBuildingsFromGeoJson()
    {
        const GEOJSON_URL = 'https://mapsmania.github.io/globalbuilding/building.geojson';
        console.log('[TankGame] Loading GeoJSON from', GEOJSON_URL);

        const res = await fetch(GEOJSON_URL);
        if (!res.ok) throw new Error(`Failed to fetch GeoJSON (${res.status})`);
        const geojson = await res.json();

        // Compute lat/lon bbox of features (we assume Polygons and MultiPolygons)
        let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

        const extractRings = (geom) =>
        {
            if (!geom) return [];
            if (geom.type === 'Polygon') return geom.coordinates;
            if (geom.type === 'MultiPolygon')
            {
                // flatten all polygon first rings
                return geom.coordinates.flat();
            }
            return [];
        };

        for (const feature of geojson.features)
        {
            const rings = extractRings(feature.geometry);
            for (const ring of rings)
            {
                for (const [lon, lat] of ring)
                {
                    if (lon < minLon) minLon = lon;
                    if (lon > maxLon) maxLon = lon;
                    if (lat < minLat) minLat = lat;
                    if (lat > maxLat) maxLat = lat;
                }
            }
        }

        if (!isFinite(minLon))
        {
            throw new Error('GeoJSON has no coordinate data');
        }

        // Add small padding (degrees)
        const padDegLon = (maxLon - minLon) * 0.02 || 0.0001;
        const padDegLat = (maxLat - minLat) * 0.02 || 0.0001;
        minLon -= padDegLon; maxLon += padDegLon;
        minLat -= padDegLat; maxLat += padDegLat;

        // Convert lat/lon to world coordinates (fit bbox to this.world)
        const lonToX = (lon) => {
            return ((lon - minLon) / (maxLon - minLon)) * this.world.width;
        };
        const latToY = (lat) => {
            // flip Y so larger lat = smaller y (world origin top-left)
            return this.world.height - ((lat - minLat) / (maxLat - minLat)) * this.world.height;
        };

        // Options
        const simplifyEpsilonInWorldUnits = 2.5; // increase to reduce vertices more (tweak)
        let idCounter = 0;
        const newBuildings = [];

        for (const feature of geojson.features)
        {
            const rings = extractRings(feature.geometry); // array of rings (outer + possible inner holes)
            if (!rings || rings.length === 0) continue;

            // We'll only use the outer ring for collision/rendering (ignore holes for simplicity)
            const outer = rings[0];
            if (!outer || outer.length < 3) continue;

            // Convert to world coords
            const pts = outer.map(([lon, lat]) => ({ x: lonToX(lon), y: latToY(lat) }));

            // Simplify in world units using RDP
            const simplified = rdpSimplify(pts, simplifyEpsilonInWorldUnits);

            // Ensure polygons are valid (at least triangle)
            if (simplified.length < 3) continue;

            // Calculate bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of simplified)
            {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }

            // Random color palette (or use feature.properties if available)
            const neonColors = [
                '#8b5cf6', '#06b6d4', '#f97316', '#f43f5e',
                '#10b981', '#facc15', '#60a5fa', '#ec4899'
            ];
            const color = feature.properties && feature.properties.fill || neonColors[idCounter % neonColors.length];

            newBuildings.push({
                id: idCounter++,
                type: 'polygon',
                points: simplified, // [{x,y}, ...]
                bbox: { minX, minY, maxX, maxY },
                color,
                sourceProps: feature.properties || {}
            });
        }

        // Replace buildings array with new simplified polygons
        this.buildings = newBuildings;

        // Build spatial index (uniform grid)
        this._buildGridIndex();

        console.log(`[TankGame] Loaded ${this.buildings.length} buildings from GeoJSON (simplified).`);
    }

    // ---------------------------
    // ORIGINAL fallback procedural generator (kept for fallback)
    // ---------------------------
    initBuildings()
    {
        // Generate city-block layout with streets (unchanged fallback)
        const blockSize = 400;  // Size of each city block
        const streetWidth = 150; // Width of streets (wide enough for tanks)
        const buildingMargin = 20; // Space between buildings in a block

        const blocksX = Math.floor(this.world.width / (blockSize + streetWidth));
        const blocksY = Math.floor(this.world.height / (blockSize + streetWidth));

        // Center the grid in the world
        const offsetX = (this.world.width - (blocksX * (blockSize + streetWidth))) / 2;
        const offsetY = (this.world.height - (blocksY * (blockSize + streetWidth))) / 2;

        for (let bx = 0; bx < blocksX; bx++)
        {
            for (let by = 0; by < blocksY; by++)
            {
                const blockX = offsetX + bx * (blockSize + streetWidth);
                const blockY = offsetY + by * (blockSize + streetWidth);

                // Randomly decide if this block has buildings (80% chance)
                if (Math.random() > 0.2)
                {
                    // Create 2-4 buildings per block
                    const buildingCount = 2 + Math.floor(Math.random() * 3);

                    for (let i = 0; i < buildingCount; i++)
                    {
                        // Subdivide the block
                        let bldX, bldY, bldW, bldH;

                        if (buildingCount === 2)
                        {
                            // Split horizontally or vertically
                            if (Math.random() > 0.5)
                            {
                                bldW = blockSize - buildingMargin * 2;
                                bldH = (blockSize - buildingMargin * 3) / 2;
                                bldX = blockX + buildingMargin;
                                bldY = blockY + buildingMargin + i * (bldH + buildingMargin);
                            }
                            else
                            {
                                bldW = (blockSize - buildingMargin * 3) / 2;
                                bldH = blockSize - buildingMargin * 2;
                                bldX = blockX + buildingMargin + i * (bldW + buildingMargin);
                                bldY = blockY + buildingMargin;
                            }
                        }
                        else if (buildingCount === 3)
                        {
                            // One large, two small
                            if (i === 0)
                            {
                                bldW = (blockSize - buildingMargin * 3) / 2;
                                bldH = blockSize - buildingMargin * 2;
                                bldX = blockX + buildingMargin;
                                bldY = blockY + buildingMargin;
                            }
                            else
                            {
                                bldW = (blockSize - buildingMargin * 3) / 2;
                                bldH = (blockSize - buildingMargin * 3) / 2;
                                bldX = blockX + buildingMargin + (blockSize - buildingMargin * 2) / 2 + buildingMargin;
                                bldY = blockY + buildingMargin + (i - 1) * (bldH + buildingMargin);
                            }
                        }
                        else // 4 buildings
                        {
                            // 2x2 grid
                            const col = i % 2;
                            const row = Math.floor(i / 2);
                            bldW = (blockSize - buildingMargin * 3) / 2;
                            bldH = (blockSize - buildingMargin * 3) / 2;
                            bldX = blockX + buildingMargin + col * (bldW + buildingMargin);
                            bldY = blockY + buildingMargin + row * (bldH + buildingMargin);
                        }

                        // Random interior texture pattern and neon color
                        const patterns = ['diagonal', 'horizontal', 'vertical', 'cross'];
                        const neonColors = [
                            '#ff0080', '#00ffff', '#ffff00', '#ff00ff',
                            '#00ff00', '#ff8000', '#0080ff', '#ff0040'
                        ];

                        this.buildings.push({
                            x: bldX,
                            y: bldY,
                            w: bldW,
                            h: bldH,
                            pattern: patterns[Math.floor(Math.random() * patterns.length)],
                            color: neonColors[Math.floor(Math.random() * neonColors.length)]
                        });
                    }
                }
            }
        }

        // If procedural buildings created, build grid index from them too:
        if (this.buildings.length && !this.buildings[0].type)
        {
            // Convert old rectangles to polygon-like objects for compatibility
            this.buildings = this.buildings.map((r, idx) => {
                return {
                    id: idx,
                    type: 'rect',
                    x: r.x, y: r.y, w: r.w, h: r.h,
                    bbox: { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h },
                    color: r.color || '#888',
                    pattern: r.pattern || 'horizontal'
                };
            });
            this._buildGridIndex();
        }

        console.log(`[TankGame] Generated ${this.buildings.length} buildings in city grid (fallback)`);
    }

    // ---------------------------
    // Build a simple uniform grid index for spatial queries (no external libs)
    // ---------------------------
    _buildGridIndex()
    {
        // build grid cells keyed by col,row
        const cellSize = this._gridCellSize;
        const cols = Math.ceil(this.world.width / cellSize);
        const rows = Math.ceil(this.world.height / cellSize);

        const grid = new Map(); // key => array of building refs

        const cellKey = (c, r) => `${c},${r}`;

        for (const b of this.buildings)
        {
            // convert bbox to cell range
            const minC = Math.max(0, Math.floor(b.bbox.minX / cellSize));
            const maxC = Math.min(cols - 1, Math.floor(b.bbox.maxX / cellSize));
            const minR = Math.max(0, Math.floor(b.bbox.minY / cellSize));
            const maxR = Math.min(rows - 1, Math.floor(b.bbox.maxY / cellSize));

            for (let c = minC; c <= maxC; c++)
            {
                for (let r = minR; r <= maxR; r++)
                {
                    const k = cellKey(c, r);
                    if (!grid.has(k)) grid.set(k, []);
                    grid.get(k).push(b);
                }
            }
        }

        this._gridIndex = {
            grid,
            cellSize,
            cols,
            rows,
            cellKey
        };
    }

    // Query nearby buildings by world X,Y and radius (returns unique building refs)
    queryNearbyBuildings(x, y, radius = 400)
    {
        if (!this._gridIndex) return [];

        const { grid, cellSize, cols, rows, cellKey } = this._gridIndex;

        const minC = Math.max(0, Math.floor((x - radius) / cellSize));
        const maxC = Math.min(cols - 1, Math.floor((x + radius) / cellSize));
        const minR = Math.max(0, Math.floor((y - radius) / cellSize));
        const maxR = Math.min(rows - 1, Math.floor((y + radius) / cellSize));

        const seen = new Set();
        const results = [];

        for (let c = minC; c <= maxC; c++)
        {
            for (let r = minR; r <= maxR; r++)
            {
                const k = cellKey(c, r);
                const list = grid.get(k);
                if (!list) continue;
                for (const b of list)
                {
                    if (seen.has(b.id)) continue;
                    seen.add(b.id);
                    // coarse bbox distance test
                    const dx = Math.max(0, Math.max(b.bbox.minX - x, x - b.bbox.maxX));
                    const dy = Math.max(0, Math.max(b.bbox.minY - y, y - b.bbox.maxY));
                    const distSq = dx*dx + dy*dy;
                    if (distSq <= radius*radius) results.push(b);
                }
            }
        }

        return results;
    }

    // ---------------------------
    // Fix for tankofduty-game.js - Prevent spawning inside buildings (keeps same)
    // ---------------------------
    findSafeSpawnPoint(playerIndex, totalPlayers)
    {
        // Create spawn points around the map edges, evenly distributed
        const margin = 300;
        const spawnPositions = [
            { x: margin, y: margin }, // Top-left
            { x: this.world.width - margin, y: margin }, // Top-right
            { x: margin, y: this.world.height - margin }, // Bottom-left
            { x: this.world.width - margin, y: this.world.height - margin }, // Bottom-right
            { x: this.world.width / 2, y: margin }, // Top-center
            { x: this.world.width / 2, y: this.world.height - margin }, // Bottom-center
            { x: margin, y: this.world.height / 2 }, // Left-center
            { x: this.world.width - margin, y: this.world.height / 2 }, // Right-center
        ];

        // Get position for this player
        const basePos = spawnPositions[playerIndex % spawnPositions.length];

        // Try to find a clear spot near the base position
        // Increase attempts and search radius to ensure we find a safe spot
        for (let attempt = 0; attempt < 50; attempt++)
        {
            // Increase search radius on each attempt
            const searchRadius = 200 + (attempt * 50); // Start at 200, increase to ~2700
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * searchRadius;
            const x = basePos.x + Math.cos(angle) * distance;
            const y = basePos.y + Math.sin(angle) * distance;

            // Ensure we're within world bounds with margin
            if (x < 50 || x > this.world.width - 50 || y < 50 || y > this.world.height - 50)
            {
                continue;
            }

            // Check if this spot is clear of buildings (tank radius is ~26)
            if (!this.collideWithBuildings(x, y, 30))
            {
                console.log(`[TankGame] Found safe spawn at attempt ${attempt + 1}`);
                return { x, y };
            }
        }

        // Last resort: try center of map
        console.warn('[TankGame] Could not find safe spawn near base position, trying map center');
        const centerX = this.world.width / 2;
        const centerY = this.world.height / 2;

        // Try random positions around map center
        for (let attempt = 0; attempt < 100; attempt++)
        {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 1000;
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;

            if (x < 50 || x > this.world.width - 50 || y < 50 || y > this.world.height - 50)
            {
                continue;
            }

            if (!this.collideWithBuildings(x, y, 30))
            {
                console.log(`[TankGame] Found safe spawn at map center (attempt ${attempt + 1})`);
                return { x, y };
            }
        }

        // Absolute fallback - should never happen with proper map generation
        console.error('[TankGame] WARNING: Could not find safe spawn point! Using base position anyway.');
        return basePos;
    }

    initPlayers()
    {
        const playerList = this.options.players || [];

        playerList.forEach((p, idx) =>
        {
            this.setupPlayer(p.userId, p.userName, idx);
        });

        // Join message to sync initial state
        if (!this.isSinglePlayer)
        {
            setTimeout(() =>
            {
                this.sendMessage('tank-join', {
                    playerId: this.myUserId,
                    name: this.options.myUsername,
                    colorIndex: this.myUserId % this.colours.length
                });
            }, 100);
        }
    }

    setupPlayer(id, name, colorIndex)
    {
        const spawnPoint = this.findSafeSpawnPoint(colorIndex, this.players.size + 1);
        const angle = Math.atan2(
            this.world.height / 2 - spawnPoint.y,
            this.world.width / 2 - spawnPoint.x
        );
        const tank = {
            id,
            name,
            colorIndex: colorIndex % this.colours.length,
            x: spawnPoint.x,
            y: spawnPoint.y,
            hullAngle: angle,
            turretAngle: angle,
            kills: 0,
            deaths: 0,
            isAlive: true,
            respawnAt: 0,
            lastFireTime: 0,
            isLocal: id === this.myUserId
        };

        this.players.set(id, tank);
        console.log('[TankGame] Player setup:', name, id);
    }

    setupInputHandlers()
    {
        const keys = new Set();

        const updateAxes = () =>
        {
            this.localInput.forward = (keys.has('KeyW') ? 1 : 0) + (keys.has('KeyS') ? -1 : 0);
            this.localInput.turn = (keys.has('KeyD') ? 1 : 0) + (keys.has('KeyA') ? -1 : 0);
            this.sendInputThrottled();
        };

        const keyDown = (e) =>
        {
            if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code))
            {
                keys.add(e.code);
                updateAxes();
            }
        };

        const keyUp = (e) =>
        {
            if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code))
            {
                keys.delete(e.code);
                updateAxes();
            }
        };

        const mouseMove = (e) =>
        {
            if (!this.renderer.canvas) return;
            const rect = this.renderer.canvas.getBoundingClientRect();
            const tank = this.players.get(this.myUserId);
            if (!tank) return;

            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const worldPos = this.screenToWorld(x, y, tank);

            // ALWAYS update turret angle to exact mouse position (no rounding)
            this.localInput.turretAngle = Math.atan2(worldPos.y - tank.y, worldPos.x - tank.x);

            // Send update throttled by time only (not by angle threshold)
            this.sendInputThrottled();
        };

        const mouseDown = (e) =>
        {
            if (e.button === 0)
            {
                this.localInput.firing = true;
                this.sendInputThrottled(true);
            }
        };

        const mouseUp = (e) =>
        {
            if (e.button === 0)
            {
                this.localInput.firing = false;
                this.sendInputThrottled(true);
            }
        };

        window.addEventListener('keydown', keyDown);
        window.addEventListener('keyup', keyUp);
        window.addEventListener('mousemove', mouseMove);
        window.addEventListener('mousedown', mouseDown);
        window.addEventListener('mouseup', mouseUp);

        this.cleanupInputs = () =>
        {
            window.removeEventListener('keydown', keyDown);
            window.removeEventListener('keyup', keyUp);
            window.removeEventListener('mousemove', mouseMove);
            window.removeEventListener('mousedown', mouseDown);
            window.removeEventListener('mouseup', mouseUp);
        };
    }

    sendInputThrottled(force = false)
    {
        const now = performance.now();
        if (force || now - this.lastInputSent > 50) // 50ms throttle = 20 updates/sec
        {
            this.lastInputSent = now;

            if (!this.isSinglePlayer)
            {
                this.sendMessage('tank-input', {
                    playerId: this.myUserId,
                    forward: this.localInput.forward,
                    turn: this.localInput.turn,
                    turretAngle: this.localInput.turretAngle, // Full precision
                    firing: this.localInput.firing
                });
            }
        }
    }

    screenToWorld(screenX, screenY, tank)
    {
        const canvas = this.renderer.canvas;
        const cw = canvas.width;
        const ch = canvas.height;

        // Match renderer's camera calculation EXACTLY (from tankofduty-renderer.js line 164-169)
        const scaleX = cw / 2400; // Show ~2400 units width
        const scaleY = ch / 1350; // Show ~1350 units height
        const scale = Math.min(scaleX, scaleY);

        const camX = -tank.x * scale + cw / 2;
        const camY = -tank.y * scale + ch / 2;

        // Inverse transform: screen -> world
        // Renderer does: ctx.translate(camX, camY) then ctx.scale(scale, scale)
        // So inverse is: unscale, then untranslate
        const worldX = (screenX - camX) / scale;
        const worldY = (screenY - camY) / scale;

        return {
            x: worldX,
            y: worldY
        };
    }

    update(deltaTime)
    {
        if (this.gameOverState) return;

        const dt = Math.min(deltaTime, 0.1); // Cap at 100ms

        // Update all tanks based on local or remote input
        this.players.forEach((tank) =>
        {
            if (!tank.isAlive)
            {
                // Check respawn
                if (performance.now() >= tank.respawnAt && tank.respawnAt > 0)
                {
                    this.setupPlayer(tank.id, tank.name, tank.colorIndex);
                }
                return;
            }

            // Get input for this tank
            const input = tank.isLocal ? this.localInput : tank.remoteInput || {};

            // Update tank physics
            const speed = 220;
            const turnRate = 2.4;

            tank.hullAngle += (input.turn || 0) * turnRate * dt;
            const forward = (input.forward || 0) * speed * dt;

            const nx = tank.x + Math.cos(tank.hullAngle) * forward;
            const ny = tank.y + Math.sin(tank.hullAngle) * forward;

            if (!this.collideWithBuildings(nx, ny, 26))
            {
                tank.x = Math.max(30, Math.min(this.world.width - 30, nx));
                tank.y = Math.max(30, Math.min(this.world.height - 30, ny));
            }

            tank.turretAngle = input.turretAngle ?? tank.hullAngle;

            // Handle firing
            if (input.firing && performance.now() - tank.lastFireTime > 600)
            {
                this.fireProjectile(tank);
                tank.lastFireTime = performance.now();
            }
        });

        // Update projectiles
        this.updateProjectiles(dt);

        // Update explosions
        this.updateExplosions(dt);

        // Broadcast state periodically (for late joiners or dropped packets)
        if (!this.isSinglePlayer)
        {
            this.broadcastStateThrottled();
        }
    }


    fireProjectile(tank)
    {
        const id = `${tank.id}-${Date.now()}-${Math.random()}`;
        const speed = 450;

        // Calculate velocity towards cursor/target
        const vx = Math.cos(tank.turretAngle) * speed;
        const vy = Math.sin(tank.turretAngle) * speed;

        // Spawn from CENTER of gun barrel (doubled turret size means longer barrel)
        // Barrel is now 56 units long (from turret center), plus 16 turret radius = 72 total
        const barrelLength = 72; // Updated for doubled turret size

        const projectile = {
            id,
            ownerId: tank.id,
            x: tank.x + Math.cos(tank.turretAngle) * barrelLength,
            y: tank.y + Math.sin(tank.turretAngle) * barrelLength,
            vx,
            vy,
            bounces: 0,
            createdAt: performance.now()
        };

        this.projectiles.set(id, projectile);

        // Play fire sound
        if (this.soundManager)
        {
            if (tank.id === this.myUserId)
            {
                this.soundManager.playOwnFire();
            }
            else
            {
                this.soundManager.playOpponentFire();
            }
        }

        // Broadcast projectile creation
        if (!this.isSinglePlayer)
        {
            this.broadcastMessage('tank-projectile', {
                id,
                ownerId: tank.id,
                x: projectile.x,
                y: projectile.y,
                vx,
                vy
            });
        }
    }

    // ---------------------------
    // Updated projectile update: polygon-aware bouncing/reflection
    // ---------------------------
    updateProjectiles(dt)
    {
        const toDelete = [];

        this.projectiles.forEach((proj) =>
        {
            proj.x += proj.vx * dt;
            proj.y += proj.vy * dt;

            // Wall bouncing (world bounds)
            if (proj.x < 0 || proj.x > this.world.width)
            {
                proj.vx *= -1;
                proj.x = Math.max(0, Math.min(this.world.width, proj.x));
                proj.bounces++;
            }
            if (proj.y < 0 || proj.y > this.world.height)
            {
                proj.vy *= -1;
                proj.y = Math.max(0, Math.min(this.world.height, proj.y));
                proj.bounces++;
            }

            // Building bouncing (polygon aware)
            // Query nearby buildings around projectile
            const nearby = this.queryNearbyBuildings(proj.x, proj.y, 40);
            for (const bld of nearby)
            {
                if (bld.type === 'rect')
                {
                    // legacy rect handling
                    if (proj.x > bld.x && proj.x < bld.x + bld.w &&
                        proj.y > bld.y && proj.y < bld.y + bld.h)
                    {
                        const cx = bld.x + bld.w / 2;
                        const cy = bld.y + bld.h / 2;
                        const dx = proj.x - cx;
                        const dy = proj.y - cy;
                        if (Math.abs(dx) > Math.abs(dy))
                        {
                            proj.vx *= -1;
                        }
                        else
                        {
                            proj.vy *= -1;
                        }
                        proj.bounces++;
                    }
                }
                else if (bld.type === 'polygon')
                {
                    // If projectile inside polygon, reflect against nearest edge normal
                    if (pointInPolygon({x: proj.x, y: proj.y}, bld.points))
                    {
                        const { nearestSeg, nearestPoint } = nearestSegmentToPoint(proj.x, proj.y, bld.points);
                        if (nearestSeg)
                        {
                            const nx = -(nearestSeg.y2 - nearestSeg.y1);
                            const ny = (nearestSeg.x2 - nearestSeg.x1);
                            const nlen = Math.hypot(nx, ny) || 1;
                            const nxu = nx / nlen;
                            const nyu = ny / nlen;

                            // reflect velocity: v' = v - 2*(v·n)*n
                            const vdotn = proj.vx * nxu + proj.vy * nyu;
                            proj.vx = proj.vx - 2 * vdotn * nxu;
                            proj.vy = proj.vy - 2 * vdotn * nyu;

                            // move projectile slightly outside to avoid sticking
                            proj.x = nearestPoint.x + nxu * 2;
                            proj.y = nearestPoint.y + nyu * 2;

                            proj.bounces++;
                        }
                    }
                }
            }

            // Hit detection
            this.players.forEach((tank) =>
            {
                if (!tank.isAlive || tank.id === proj.ownerId) return;

                const dist = Math.hypot(proj.x - tank.x, proj.y - tank.y);
                if (dist < 26)
                {
                    this.handleTankHit(tank, proj);
                    toDelete.push(proj.id);
                }
            });

            // Lifetime / bounce limit
            if (proj.bounces > 6 || performance.now() - proj.createdAt > 8000)
            {
                toDelete.push(proj.id);
            }
        });

        toDelete.forEach(id => this.projectiles.delete(id));
    }

    handleTankHit(tank, projectile)
    {
        tank.isAlive = false;
        tank.deaths++;
        tank.respawnAt = performance.now() + 3000;

        // Create explosion effect locally
        this.createExplosion(tank.x, tank.y, this.colours[tank.colorIndex]);

        // Play explosion sound
        if (this.soundManager)
        {
            if (tank.id === this.myUserId)
            {
                this.soundManager.playOwnExplosion();
            }
            else
            {
                this.soundManager.playOpponentExplosion();
            }
        }

        const shooter = this.players.get(projectile.ownerId);
        if (shooter)
        {
            shooter.kills++;

            // Check for victory
            if (shooter.kills >= 10)
            {
                this.endGame(shooter);
            }
        }

        // Broadcast death event WITH explosion data
        if (!this.isSinglePlayer)
        {
            this.broadcastMessage('tank-death', {
                tankId: tank.id,
                shooterId: projectile.ownerId,
                x: tank.x,
                y: tank.y,
                color: this.colours[tank.colorIndex] // Include color for explosion
            });
        }
    }

    createExplosion(x, y, color)
    {
        this.explosions.push({
            x,
            y,
            color,
            startTime: performance.now(),
            duration: 800, // 800ms animation
            particles: this.generateExplosionParticles(x, y, color)
        });
    }

    generateExplosionParticles(x, y, color)
    {
        const particles = [];
        const particleCount = 30;

        for (let i = 0; i < particleCount; i++)
        {
            const angle = (Math.PI * 2 * i) / particleCount;
            const speed = 100 + Math.random() * 200;

            particles.push({
                x: 0,
                y: 0,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 4 + Math.random() * 8,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 10
            });
        }

        return particles;
    }

    updateExplosions(dt)
    {
        const now = performance.now();

        // Update particle positions
        this.explosions.forEach(explosion =>
        {
            explosion.particles.forEach(p =>
            {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.rotation += p.rotationSpeed * dt;

                // Gravity and drag
                p.vy += 200 * dt;
                p.vx *= 0.95;
                p.vy *= 0.95;
            });
        });

        // Remove finished explosions
        this.explosions = this.explosions.filter(e =>
        {
            return now - e.startTime < e.duration;
        });
    }

    endGame(winner)
    {
        this.gameOverState = {
            winner: winner.name,
            winnerId: winner.id,
            scores: Array.from(this.players.values()).map(p => ({
                name: p.name,
                kills: p.kills,
                deaths: p.deaths
            }))
        };

        if (!this.isSinglePlayer)
        {
            this.broadcastMessage('tank-game-over', this.gameOverState);
        }
    }

    // ---------------------------
    // Updated collision: circle-polygon + rect fallback
    // ---------------------------
    collideWithBuildings(x, y, radius)
    {
        // Query nearby buildings (radius) and test accurately
        const nearby = this.queryNearbyBuildings(x, y, radius + 10);

        return nearby.some((bld) =>
        {
            if (bld.type === 'rect')
            {
                const closestX = Math.max(bld.x, Math.min(x, bld.x + bld.w));
                const closestY = Math.max(bld.y, Math.min(y, bld.y + bld.h));
                const dist = Math.hypot(x - closestX, y - closestY);
                return dist < radius;
            }

            if (bld.type === 'polygon')
            {
                // If center of circle is inside polygon -> collide
                if (pointInPolygon({x, y}, bld.points)) return true;

                // If distance to any edge < radius -> collide
                for (let i = 0; i < bld.points.length; i++)
                {
                    const a = bld.points[i];
                    const b = bld.points[(i + 1) % bld.points.length];
                    const d = distancePointToSegment(x, y, a.x, a.y, b.x, b.y);
                    if (d < radius) return true;
                }
            }

            return false;
        });
    }

    broadcastStateThrottled()
    {
        const now = performance.now();
        if (!this.lastStateBroadcast || now - this.lastStateBroadcast > 200)
        {
            this.lastStateBroadcast = now;

            this.broadcastMessage('tank-state-update', {
                players: Array.from(this.players.values()).map(p => ({
                    id: p.id,
                    x: p.x,
                    y: p.y,
                    hullAngle: p.hullAngle,
                    turretAngle: p.turretAngle,
                    isAlive: p.isAlive,
                    kills: p.kills,
                    deaths: p.deaths
                }))
            });
        }
    }

    handleMessage(messageType, data)
    {
        switch (messageType)
        {
            case 'tank-map-init':
                // Receive map from host
                // Expect buildings as simplified polygons (or fallback rect list)
                this.buildings = data.buildings || [];
                this.world = data.worldSize || this.world;

                // Rebuild client-side spatial index so collision/rendering queries are fast
                this._buildGridIndex();

                console.log('[TankGame] Received map from host:', this.buildings.length, 'buildings');
                break;

            case 'tank-join':
                if (!this.players.has(data.playerId))
                {
                    this.setupPlayer(data.playerId, data.name, data.colorIndex);
                }

                // Host immediately sends map data to joining player
                if (this.isHost)
                {
                    this.broadcastMessage('tank-map-init', {
                        buildings: this.buildings,
                        worldSize: this.world
                    });
                }
                break;

            case 'tank-input':
                const tank = this.players.get(data.playerId);
                if (tank && !tank.isLocal)
                {
                    tank.remoteInput = {
                        forward: data.forward,
                        turn: data.turn,
                        turretAngle: data.turretAngle,
                        firing: data.firing
                    };
                }
                break;

            case 'tank-state-update':
                data.players.forEach(pd =>
                {
                    const tank = this.players.get(pd.id);
                    if (tank && !tank.isLocal)
                    {
                        // Check if this is a respawn (big position jump)
                        const distanceJump = Math.hypot(pd.x - tank.x, pd.y - tank.y);
                        const isRespawn = distanceJump > 500; // More than 500 units = respawn

                        if (isRespawn)
                        {
                            // Snap to new position (respawn)
                            tank.x = pd.x;
                            tank.y = pd.y;
                        } else
                        {
                            // Smooth remote player positions
                            tank.x = tank.x * 0.7 + pd.x * 0.3;
                            tank.y = tank.y * 0.7 + pd.y * 0.3;
                        }

                        tank.hullAngle = pd.hullAngle;
                        tank.turretAngle = pd.turretAngle;
                        tank.isAlive = pd.isAlive;
                        tank.kills = pd.kills;
                        tank.deaths = pd.deaths;
                    }
                });
                break;

            case 'tank-projectile':
                if (!this.projectiles.has(data.id))
                {
                    this.projectiles.set(data.id, {
                        id: data.id,
                        ownerId: data.ownerId,
                        x: data.x,
                        y: data.y,
                        vx: data.vx,
                        vy: data.vy,
                        bounces: 0,
                        createdAt: performance.now()
                    });

                    // Play fire sound for remote projectile - ADD THIS
                    if (this.soundManager && data.ownerId !== this.myUserId)
                    {
                        this.soundManager.playOpponentFire();
                    }
                }
                break;

            case 'tank-death':
                const deadTank = this.players.get(data.tankId);
                if (deadTank)
                {
                    deadTank.isAlive = false;
                    deadTank.deaths++;
                    deadTank.respawnAt = performance.now() + 3000;

                    // Create explosion effect for ALL players (not just remote)
                    this.createExplosion(data.x, data.y, data.color || this.colours[deadTank.colorIndex]);

                    // Play explosion sound for remote death - ADD THIS
                    if (this.soundManager && deadTank.id !== this.myUserId)
                    {
                        this.soundManager.playOpponentExplosion();
                    }
                }
                const shooter = this.players.get(data.shooterId);
                if (shooter)
                {
                    shooter.kills++;
                }
                break;

            case 'tank-game-over':
                this.gameOverState = data;
                break;

            case 'tank-new-match':
                this.startNewMatch();
                break;
        }
    }

    startNewMatch()
    {
        this.players.forEach(p =>
        {
            p.kills = 0;
            p.deaths = 0;
            this.setupPlayer(p.id, p.name, p.colorIndex);
        });
        this.projectiles.clear();
        this.gameOverState = null;
    }

    getGameState()
    {
        return {
            players: Array.from(this.players.values()),
            projectiles: Array.from(this.projectiles.values()),
            buildings: this.buildings,
            world: this.world,
            myUserId: this.myUserId,
            colours: this.colours,
            gameOverState: this.gameOverState,
            explosions: this.explosions
        };
    }

    dispose()
    {
        if (this.cleanupInputs)
        {
            this.cleanupInputs();
        }
        this.players.clear();
        this.projectiles.clear();
    }
}

// ---------------------------
// Utility functions (RDP simplify, point-in-polygon, distance-to-segment, nearest edge)
// ---------------------------

// Ramer-Douglas-Peucker (operates on array of {x,y})
function rdpSimplify(points, epsilon)
{
    if (!points || points.length < 3) return points.slice();

    const sq = (n) => n * n;

    function perpendicularDistance(p, a, b)
    {
        const x = p.x, y = p.y;
        const x1 = a.x, y1 = a.y;
        const x2 = b.x, y2 = b.y;

        const dx = x2 - x1;
        const dy = y2 - y1;

        if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);

        const t = ((x - x1) * dx + (y - y1) * dy) / (dx*dx + dy*dy);
        const projx = x1 + t * dx;
        const projy = y1 + t * dy;
        return Math.hypot(x - projx, y - projy);
    }

    function rdp(start, end, arr, out)
    {
        let maxDist = 0;
        let index = -1;
        for (let i = start + 1; i < end; i++)
        {
            const d = perpendicularDistance(arr[i], arr[start], arr[end]);
            if (d > maxDist) { index = i; maxDist = d; }
        }

        if (maxDist > epsilon && index !== -1)
        {
            rdp(start, index, arr, out);
            rdp(index, end, arr, out);
        }
        else
        {
            out.push(arr[start]);
        }
    }

    const out = [];
    rdp(0, points.length - 1, points, out);
    out.push(points[points.length - 1]);
    return out;
}

// point-in-polygon (winding / raycast)
function pointInPolygon(pt, poly)
{
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
            (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// distance from point to segment
function distancePointToSegment(px, py, x1, y1, x2, y2)
{
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq !== 0 ? dot / lenSq : -1;

    let xx, yy;

    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }

    return Math.hypot(px - xx, py - yy);
}

// find nearest segment to point, returns { nearestSeg: {x1,y1,x2,y2}, nearestPoint:{x,y}, dist }
function nearestSegmentToPoint(px, py, poly)
{
    let best = { dist: Infinity, nearestSeg: null, nearestPoint: null };
    for (let i = 0; i < poly.length; i++)
    {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];

        // project point onto segment AB
        const x1 = a.x, y1 = a.y;
        const x2 = b.x, y2 = b.y;
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        const dot = A * C + B * D;
        const lenSq = C*C + D*D;
        let t = lenSq !== 0 ? dot / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const projx = x1 + C * t;
        const projy = y1 + D * t;
        const d = Math.hypot(px - projx, py - projy);
        if (d < best.dist)
        {
            best.dist = d;
            best.nearestSeg = { x1, y1, x2, y2 };
            best.nearestPoint = { x: projx, y: projy };
        }
    }
    return best;
}
