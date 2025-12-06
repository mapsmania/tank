// TripGeo.Client/wwwroot/geobox-assets/games/tankofduty/tankofduty-renderer.js
// Rendering for Tank of Duty

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

        const { players, projectiles, buildings, world, myUserId, colours, gameOverState } = gameState;

        const localPlayer = players.find(p => p.id === myUserId);
        if (!localPlayer) return;

        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // Calculate camera transform to follow local player
        // Show more of the world (wider view)
        const scaleX = cw / 2400; // Show ~2400 units width
        const scaleY = ch / 1350; // Show ~1350 units height
        const scale = Math.min(scaleX, scaleY);

        const camX = -localPlayer.x * scale + cw / 2;
        const camY = -localPlayer.y * scale + ch / 2;

        ctx.save();
        ctx.clearRect(0, 0, cw, ch);

        // Background
        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(0, 0, cw, ch);

        ctx.translate(camX, camY);
        ctx.scale(scale, scale);

        // Grid
        this.drawGrid(ctx, world);

        // Buildings with interior patterns
        buildings.forEach(bld =>
        {
            // Dark base fill
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(bld.x, bld.y, bld.w, bld.h);

            // Draw interior pattern with neon color
            ctx.strokeStyle = bld.color || '#0cf';
            ctx.lineWidth = 2;

            const spacing = 20;
            ctx.beginPath();

            switch (bld.pattern)
            {
                case 'diagonal':
                    // FIXED: Cross-diagonal lines that stay within building bounds
                    // Draw diagonals from top-left to bottom-right
                    for (let offset = 0; offset <= bld.w + bld.h; offset += spacing)
                    {
                        let startX = bld.x;
                        let startY = bld.y + offset;
                        let endX = bld.x + offset;
                        let endY = bld.y;

                        // Clip to building bounds
                        if (startY > bld.y + bld.h)
                        {
                            startX = bld.x + (startY - (bld.y + bld.h));
                            startY = bld.y + bld.h;
                        }
                        if (endX > bld.x + bld.w)
                        {
                            endY = bld.y + (endX - (bld.x + bld.w));
                            endX = bld.x + bld.w;
                        }

                        ctx.moveTo(startX, startY);
                        ctx.lineTo(endX, endY);
                    }

                    // Draw diagonals from bottom-left to top-right
                    for (let offset = 0; offset <= bld.w + bld.h; offset += spacing)
                    {
                        let startX = bld.x;
                        let startY = bld.y + bld.h - offset;
                        let endX = bld.x + offset;
                        let endY = bld.y + bld.h;

                        // Clip to building bounds
                        if (startY < bld.y)
                        {
                            startX = bld.x + (bld.y - startY);
                            startY = bld.y;
                        }
                        if (endX > bld.x + bld.w)
                        {
                            endY = bld.y + bld.h - (endX - (bld.x + bld.w));
                            endX = bld.x + bld.w;
                        }

                        ctx.moveTo(startX, startY);
                        ctx.lineTo(endX, endY);
                    }
                    break;

                case 'horizontal':
                    // Straight horizontal lines
                    for (let y = bld.y + spacing; y < bld.y + bld.h; y += spacing)
                    {
                        ctx.moveTo(bld.x, y);
                        ctx.lineTo(bld.x + bld.w, y);
                    }
                    break;

                case 'vertical':
                    // Vertical lines
                    for (let x = bld.x + spacing; x < bld.x + bld.w; x += spacing)
                    {
                        ctx.moveTo(x, bld.y);
                        ctx.lineTo(x, bld.y + bld.h);
                    }
                    break;

                case 'cross':
                    // Both horizontal and vertical (grid)
                    for (let y = bld.y + spacing; y < bld.y + bld.h; y += spacing)
                    {
                        ctx.moveTo(bld.x, y);
                        ctx.lineTo(bld.x + bld.w, y);
                    }
                    for (let x = bld.x + spacing; x < bld.x + bld.w; x += spacing)
                    {
                        ctx.moveTo(x, bld.y);
                        ctx.lineTo(x, bld.y + bld.h);
                    }
                    break;
            }

            ctx.stroke();

            // Building outline
            ctx.strokeStyle = '#0cf';
            ctx.lineWidth = 3;
            ctx.strokeRect(bld.x, bld.y, bld.w, bld.h);
        });

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
        this.renderExplosions(ctx, gameState.explosions, colours);

        // FINISH LINE MARKER
if (world.finishX !== undefined && world.finishY !== undefined)
{
    const fx = world.finishX;
    const fy = world.finishY;

    ctx.save();
    ctx.translate(fx, fy);

    const size = 120; // flag width
    const square = 20; // checkered square size

    // Flag pole
    ctx.fillStyle = '#444';
    ctx.fillRect(-10, -size / 2, 10, size * 1.2);

    // Checkered flag
    for (let y = 0; y < size; y += square)
    {
        for (let x = 0; x < size; x += square)
        {
            const isBlack = ((x / square) + (y / square)) % 2 === 0;
            ctx.fillStyle = isBlack ? '#000' : '#fff';
            ctx.fillRect(x, y - size / 2, square, square);
        }
    }

    // Optional glowing outline
    ctx.strokeStyle = '#0cf';
    ctx.lineWidth = 4;
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#0cf';
    ctx.strokeRect(0, -size / 2, size, size);

    ctx.restore();
}


        // Tanks
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
            // Hull shape: streamlined wedge with tapered front and angled corners
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
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#f44';
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
