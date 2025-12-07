// TripGeo.Client/wwwroot/geobox-assets/games/tankofduty/tankofduty-game.js
// Game logic for Tank of Duty with WebRTC peer-to-peer synchronization

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
        this.buildings = [];

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

        // Host generates the map and broadcasts it
        if (this.isHost)
        {
            this.initBuildings();
            if (!this.isSinglePlayer)
            {
                // Broadcast map to all players
                setTimeout(() =>
                {
                    this.broadcastMessage('tank-map-init', {
                        buildings: this.buildings,
                        worldSize: this.world
                    });
                }, 50);
            }
        }

        this.initPlayers();
        this.setupInputHandlers();

        console.log('[TankGame] Initialized', { isHost: this.isHost, players: this.players.size });
    }

    initBuildings()
    {
        // Generate city-block layout with streets
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

        console.log(`[TankGame] Generated ${this.buildings.length} buildings in city grid`);
    }

    // Fix for tankofduty-game.js - Prevent spawning inside buildings
    // Replace the findSafeSpawnPoint function (around line 187) with this improved version:

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
            const searchRadius = 200 + (attempt * 50); // Start at 200, increase to 2700
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

    updateProjectiles(dt)
    {
        const toDelete = [];

        this.projectiles.forEach((proj) =>
        {
            proj.x += proj.vx * dt;
            proj.y += proj.vy * dt;

            // Wall bouncing
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

            // Building bouncing
            this.buildings.forEach((bld) =>
            {
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
            });

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
            if (proj.bounces > 5 || performance.now() - proj.createdAt > 8000)
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

    collideWithBuildings(x, y, radius)
    {
        return this.buildings.some((bld) =>
        {
            const closestX = Math.max(bld.x, Math.min(x, bld.x + bld.w));
            const closestY = Math.max(bld.y, Math.min(y, bld.y + bld.h));
            const dist = Math.hypot(x - closestX, y - closestY);
            return dist < radius;
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
                this.buildings = data.buildings || [];
                this.world = data.worldSize || this.world;
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
