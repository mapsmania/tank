// TripGeo.Client/wwwroot/geobox-assets/games/tankofduty/tankofduty-renderer.js
// Rendering for Tank of Duty (polygon-capable)
// Reworked to support polygon buildings (bld.type === 'polygon' with bld.points [{x,y},...])
// Backwards-compatible with rectangle buildings { x,y,w,h }
// Renders only buildings within camera view for performance.

export class TankRenderer
{
    constructor(canvas, hudElement)
    {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.hudElement = hudElement;
    }

    resizeCanvas()
    {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        const rect = parent.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
    }

    roundRect(ctx, x, y, width, height, radius)
    {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    // -------------------------
    // Polygon helper methods
    // -------------------------

    // Draw polygon given an array of [x,y] pairs OR [{x,y}, ...]
    drawPolygonPath(ctx, coords)
    {
        if (!coords || coords.length === 0) return;

        // Accept either [[x,y],...] or [{x,y},...]
        const first = Array.isArray(coords[0]) ? { x: coords[0][0], y: coords[0][1] } : coords[0];

        ctx.beginPath();
        ctx.moveTo(first.x, first.y);

        for (let i = 1; i < coords.length; i++)
        {
            const p = Array.isArray(coords[i]) ? { x: coords[i][0], y: coords[i][1] } : coords[i];
            ctx.lineTo(p.x, p.y);
        }

        ctx.closePath();
    }

    // Check if building bbox intersects current camera view (fast culling)
    buildingInView(bbox, camRect)
    {
        if (!bbox) return true;
        return !(bbox.maxX < camRect.xMin || bbox.minX > camRect.xMax || bbox.maxY < camRect.yMin || bbox.minY > camRect.yMax);
    }

    // Draw a polygon building (outer ring only; holes are ignored if stored)
    drawPolygonBuilding(ctx, bld)
    {
        // bld.points: array of {x,y}
        if (!bld || !bld.points || bld.points.length < 3) return;

        // Base dark fill
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; // dark interior
        this.drawPolygonPath(ctx, bld.points);
        ctx.fill();

        // Neon interior pattern (approximate previous patterns)
        const spacing = 18;
        const color = bld.color || '#0cf';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;

        // Simple hatch: horizontal lines clipped by polygon path
        ctx.save();
        this.drawPolygonPath(ctx, bld.points);
        ctx.clip();

        // compute approximate bbox for poly to limit hatch lines
        const minX = bld.bbox ? bld.bbox.minX : Math.min(...bld.points.map(p => p.x));
        const maxX = bld.bbox ? bld.bbox.maxX : Math.max(...bld.points.map(p => p.x));
        const minY = bld.bbox ? bld.bbox.minY : Math.min(...bld.points.map(p => p.y));
        const maxY = bld.bbox ? bld.bbox.maxY : Math.max(...bld.points.map(p => p.y));

        for (let y = minY + spacing; y < maxY; y += spacing)
        {
            ctx.beginPath();
            ctx.moveTo(minX - spacing, y);
            ctx.lineTo(maxX + spacing, y);
            ctx.stroke();
        }
        ctx.restore();

        // Outline
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.0;
        this.drawPolygonPath(ctx, bld.points);
        ctx.stroke();

        ctx.restore();
    }

    // Draw legacy rectangle building
    drawRectBuilding(ctx, bld)
    {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(bld.x, bld.y, bld.w, bld.h);

        ctx.strokeStyle = bld.color || '#0cf';
        ctx.lineWidth = 3;
        ctx.strokeRect(bld.x, bld.y, bld.w, bld.h);

        // interior pattern like before (horizontal lines for perf)
        ctx.strokeStyle = bld.color || '#0cf';
        ctx.lineWidth = 1;
        const spacing = 20;
        ctx.beginPath();
        for (let y = bld.y + spacing; y < bld.y + bld.h; y += spacing)
        {
            ctx.moveTo(bld.x, y);
            ctx.lineTo(bld.x + bld.w, y);
        }
        ctx.stroke();

        ctx.restore();
    }

    // Render only visible buildings (from gameState.buildings)
    renderBuildings(ctx, buildings, camRect)
    {
        if (!buildings || buildings.length === 0) return;

        for (let i = 0; i < buildings.length; i++)
        {
            const bld = buildings[i];

            // Accept two shapes:
            // - legacy rects: {x,y,w,h}
            // - polygon: { type:'polygon', points:[{x,y},...], bbox }
            // - alternative: geometry-like { geometry: { type: 'Polygon', coordinates: [...] } } (handle gracefully)

            // Build a bbox if missing (cheap)
            if (!bld.bbox)
            {
                if (bld.type === 'polygon' && bld.points)
                {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (const p of bld.points)
                    {
                        if (p.x < minX) minX = p.x;
                        if (p.x > maxX) maxX = p.x;
                        if (p.y < minY) minY = p.y;
                        if (p.y > maxY) maxY = p.y;
                    }
                    bld.bbox = { minX, minY, maxX, maxY };
                }
                else if (bld.x !== undefined && bld.w !== undefined)
                {
                    bld.bbox = { minX: bld.x, minY: bld.y, maxX: bld.x + bld.w, maxY: bld.y + bld.h };
                }
                else if (bld.geometry) // geometry-like object
                {
                    const coords = bld.geometry.type === 'Polygon' ? bld.geometry.coordinates[0] :
                                   (bld.geometry.type === 'MultiPolygon' ? bld.geometry.coordinates[0][0] : []);
                    if (coords && coords.length)
                    {
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        coords.forEach(pt => {
                            const x = Array.isArray(pt) ? pt[0] : pt.x;
                            const y = Array.isArray(pt) ? pt[1] : pt.y;
                            if (x < minX) minX = x; if (x > maxX) maxX = x;
                            if (y < minY) minY = y; if (y > maxY) maxY = y;
                        });
                        bld.bbox = { minX, minY, maxX, maxY };
                    }
                }
            }

            if (!this.buildingInView(bld.bbox, camRect)) continue;

            // Draw depending on available shape
            if (bld.type === 'polygon' && bld.points && bld.points.length > 2)
            {
                // Our internal format uses bld.points = [{x,y},...]
                this.drawPolygonBuilding(ctx, bld);
            }
            else if (bld.geometry && (bld.geometry.type === 'Polygon' || bld.geometry.type === 'MultiPolygon'))
            {
                // geometry coordinates stored in geometry (array-of-arrays). Convert to our draw calls:
                const geom = bld.geometry;
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.strokeStyle = bld.color || '#0cf';
                ctx.lineWidth = 2;

                if (geom.type === 'Polygon')
                {
                    // draw outer ring
                    this.drawPolygonPath(ctx, geom.coordinates[0]);
                    ctx.fill();
                    ctx.stroke();
                }
                else if (geom.type === 'MultiPolygon')
                {
                    for (const poly of geom.coordinates)
                    {
                        this.drawPolygonPath(ctx, poly[0]);
                        ctx.fill();
                        ctx.stroke();
                    }
                }
                ctx.restore();
            }
            else if (bld.x !== undefined && bld.w !== undefined)
            {
                this.drawRectBuilding(ctx, bld);
            }
            // else unknown format: skip
        }
    }

    // Render explosions (unchanged)
    renderExplosions(ctx, explosions, colours)
    {
        explosions.forEach(explosion =>
        {
            const now = performance.now();
            const elapsed = now - explosion.startTime;
            const progress = elapsed / explosion.duration;

            if (progress >= 1) return;

            const alpha = 1 - progress;
            const scale = 1 + progress * 3;

            ctx.save();
            ctx.translate(explosion.x, explosion.y);

            // Cartoon "BOOM!" text
            if (progress < 0.6)
            {
                const boomAlpha = 1 - (progress / 0.6);
                const boomScale = 1 + progress * 2;

                ctx.save();
                ctx.scale(boomScale, boomScale);
                ctx.globalAlpha = boomAlpha;

                // Draw "BOOM" text with comic book style
                ctx.font = 'bold 60px Impact, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Black outline
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 8;
                ctx.strokeText('BOOM!', 0, 0);

                // Yellow fill
                ctx.fillStyle = '#ff0';
                ctx.fillText('BOOM!', 0, 0);

                // Add comic book star burst behind
                const starPoints = 12;
                const innerRadius = 35;
                const outerRadius = 60;

                ctx.globalAlpha = boomAlpha * 0.7;
                ctx.fillStyle = '#f80';
                ctx.beginPath();
                for (let i = 0; i < starPoints * 2; i++)
                {
                    const angle = (i * Math.PI) / starPoints;
                    const radius = i % 2 === 0 ? outerRadius : innerRadius;
                    const x = Math.cos(angle) * radius;
                    const y = Math.sin(angle) * radius;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.fill();

                ctx.restore();
            }

            // Particle debris
            ctx.globalAlpha = alpha;
            explosion.particles.forEach(p =>
            {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);

                // Draw debris pieces
                const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
                gradient.addColorStop(0, explosion.color);
                gradient.addColorStop(0.5, '#f80');
                gradient.addColorStop(1, '#f00');

                ctx.fillStyle = gradient;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);

                // Add glow
                ctx.shadowBlur = 10;
                ctx.shadowColor = explosion.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);

                ctx.restore();
            });

            // Shockwave ring
            if (progress < 0.4)
            {
                const ringProgress = progress / 0.4;
                const ringRadius = 30 + ringProgress * 100;
                const ringAlpha = (1 - ringProgress) * 0.8;

                ctx.globalAlpha = ringAlpha;
                ctx.strokeStyle = explosion.color;
                ctx.lineWidth = 8 * (1 - ringProgress);
                ctx.beginPath();
                ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
                ctx.stroke();

                ctx.shadowBlur = 20;
                ctx.shadowColor = explosion.color;
                ctx.stroke();
            }

            ctx.restore();
        });
    }

    render(gameState)
    {
        if (!gameState) return;

        const { players, projectiles, buildings, world, myUserId, colours, gameOverState, explosions } = gameState;

        const localPlayer = players.find(p => p.id === myUserId);
        if (!localPlayer) return;

        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // Calculate camera transform to follow local player
        // Show more of the world (wider view)
        const scaleX = cw / 2400; // Show ~2400 units width (your Option B)
        const scaleY = ch / 1350; // Show ~1350 units height
        const scale = Math.min(scaleX, scaleY);

        const camX = -localPlayer.x * scale + cw / 2;
        const camY = -localPlayer.y * scale + ch / 2;

        ctx.save();
        ctx.clearRect(0, 0, cw, ch);

        // Background
        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(0, 0, cw, ch);

        // Apply camera transform (world -> screen)
        ctx.translate(camX, camY);
        ctx.scale(scale, scale);

        // compute camera world bounds for culling (in world coords)
        const camHalfW = (cw / scale) / 2;
        const camHalfH = (ch / scale) / 2;
        const camRect = {
            xMin: localPlayer.x - camHalfW,
            xMax: localPlayer.x + camHalfW,
            yMin: localPlayer.y - camHalfH,
            yMax: localPlayer.y + camHalfH
        };

        // Grid
        this.drawGrid(ctx, world);

        // Buildings (polygons OR legacy rects), only visible ones are drawn
        this.renderBuildings(ctx, buildings, camRect);

        // Projectiles
        projectiles.forEach(proj =>
        {
            const owner = players.find(p => p.id === proj.ownerId);
            const color = owner ? colours[owner.colorIndex] : '#fff';

            ctx.shadowBlur = 15;
            ctx.shadowColor = color;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(proj.x, proj.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // Explosions
        this.renderExplosions(ctx, explosions || [], colours);

        // Tanks (unchanged rendering)
        players.forEach(tank =>
        {
            if (!tank.isAlive) return;

            const color = colours[tank.colorIndex];
            const isLocal = tank.id === myUserId;

            ctx.save();
            ctx.translate(tank.x, tank.y);

            // Draw tank hull (rotates with movement)
            ctx.save();
            ctx.rotate(tank.hullAngle);

            // Tank body shadow
            ctx.shadowBlur = 25;
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowOffsetX = 5;
            ctx.shadowOffsetY = 5;

            // Main hull body (wedge-shaped front)
            ctx.fillStyle = color;
            ctx.strokeStyle = isLocal ? '#fff' : '#334';
            ctx.lineWidth = 3;

            // Hull shape: wedge front, rectangular rear
            ctx.beginPath();
            ctx.moveTo(30, 0);          // Front center point (flat front)
            ctx.lineTo(22, -10);        // Front left angled corner
            ctx.lineTo(-20, -14);       // Rear left corner
            ctx.lineTo(-24, -8);        // Rear left streamline taper
            ctx.lineTo(-24, 8);         // Rear right streamline taper
            ctx.lineTo(-20, 14);        // Rear right corner
            ctx.lineTo(22, 10);         // Front right angled corner
            ctx.closePath();

            // Front wedge accent line
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(35, 0);
            ctx.lineTo(15, 0);
            ctx.stroke();

            // Hull center line
            ctx.beginPath();
            ctx.moveTo(15, -10);
            ctx.lineTo(-25, -10);
            ctx.moveTo(15, 10);
            ctx.lineTo(-25, 10);
            ctx.stroke();

            // Tracks (left)
            ctx.fillStyle = '#222';
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 2;
            this.roundRect(ctx, -32, -25, 8, 50, 3);
            ctx.fill();
            ctx.stroke();

            // Tracks (right)
            this.roundRect(ctx, 24, -25, 8, 50, 3);
            ctx.fill();
            ctx.stroke();

            // Track detail lines
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            for (let i = -20; i <= 20; i += 8)
            {
                ctx.beginPath();
                ctx.moveTo(-30, i);
                ctx.lineTo(-26, i);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(26, i);
                ctx.lineTo(30, i);
                ctx.stroke();
            }

            // Engine slats at rear (left side)
            ctx.strokeStyle = '#f44';
            ctx.lineWidth = 2;
            for (let i = -15; i <= 15; i += 6)
            {
                ctx.beginPath();
                ctx.moveTo(-30, i);
                ctx.lineTo(-26, i);
                ctx.stroke();
            }

            // Engine glow at rear
            ctx.strokeStyle = '#f66';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-30, -18);
            ctx.lineTo(-30, 18);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Hull glow
            ctx.shadowBlur = 20;
            ctx.shadowColor = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(35, 0);
            ctx.lineTo(15, -22);
            ctx.lineTo(-30, -22);
            ctx.lineTo(-30, 22);
            ctx.lineTo(15, 22);
            ctx.closePath();
            ctx.stroke();
            ctx.shadowBlur = 0;

            ctx.restore();

            // Draw turret (rotates independently) - hexagonal lozenge shape
            ctx.save();
            ctx.rotate(tank.turretAngle);

            // Turret base (larger hexagonal lozenge)
            ctx.fillStyle = color;
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;

            ctx.beginPath();
            ctx.moveTo(-16, 0);
            ctx.lineTo(-10, -20);
            ctx.lineTo(10, -20);
            ctx.lineTo(16, 0);
            ctx.lineTo(10, 20);
            ctx.lineTo(-10, 20);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Turret glow
            ctx.shadowBlur = 15;
            ctx.shadowColor = color;
            ctx.beginPath();
            ctx.moveTo(-16, 0);
            ctx.lineTo(-10, -20);
            ctx.lineTo(10, -20);
            ctx.lineTo(16, 0);
            ctx.lineTo(10, 20);
            ctx.lineTo(-10, 20);
            ctx.closePath();
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Gun barrel (longer and thicker)
            ctx.fillStyle = '#333';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.fillRect(16, -8, 56, 16);
            ctx.strokeRect(16, -8, 56, 16);

            // Barrel tip highlight
            ctx.fillStyle = color;
            ctx.fillRect(64, -5, 8, 10);

            // Barrel detail
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(20, -4);
            ctx.lineTo(64, -4);
            ctx.moveTo(20, 4);
            ctx.lineTo(64, 4);
            ctx.stroke();

            ctx.restore();
            ctx.restore();

            // Name tag with background
            ctx.save();
            ctx.font = 'bold 18px sans-serif';
            ctx.textAlign = 'center';
            const nameWidth = ctx.measureText(tank.name).width;

            // Name background
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(tank.x - nameWidth / 2 - 6, tank.y - 60, nameWidth + 12, 24);

            // Name text
            ctx.fillStyle = color;
            ctx.shadowBlur = 3;
            ctx.shadowColor = '#000';
            ctx.fillText(tank.name, tank.x, tank.y - 42);
            ctx.shadowBlur = 0;

            ctx.restore();
        });

        ctx.restore();

        // Update HUD
        this.updateHUD(players, colours, gameOverState);
    }

    drawGrid(ctx, world)
    {
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        const gridSize = 100;
        for (let x = 0; x < world.width; x += gridSize)
        {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, world.height);
            ctx.stroke();
        }
        for (let y = 0; y < world.height; y += gridSize)
        {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(world.width, y);
            ctx.stroke();
        }
    }

    updateHUD(players, colours, gameOverState)
    {
        if (!this.hudElement) return;

        let html = '<div class="scoreboard">';

        const sortedPlayers = [...players].sort((a, b) => b.kills - a.kills);

        sortedPlayers.forEach(p =>
        {
            const color = colours[p.colorIndex];
            html += `
                <div class="score-row">
                    <span style="color: ${color};">${p.name}</span>
                    <span>${p.kills} kills / ${p.deaths} deaths</span>
                </div>
            `;
        });

        html += '</div>';

        if (gameOverState)
        {
            html += `
                <div class="game-over">
                    <div style="font-size: 24px; margin-bottom: 10px;">🏆 GAME OVER 🏆</div>
                    <div style="font-size: 18px;">Winner: ${gameOverState.winner}</div>
                </div>
            `;
        }

        this.hudElement.innerHTML = html;
    }
}
