// TripGeo.Client/wwwroot/geobox-assets/games/tankofduty/tankofduty-renderer.js
// TankRenderer - Option B with building scale and dynamic draw-distance

export class TankRenderer {
    constructor(canvas, hudElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.hudElement = hudElement;

        this.BUILDING_SCALE = 2.0;   // Scale factor for buildings (doubles size and gaps)
        this.DRAW_DISTANCE = 1500;   // Only render buildings within this distance from local player
    }

    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
    }

    roundRect(ctx, x, y, width, height, radius) {
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

    renderExplosions(ctx, explosions) {
        explosions.forEach(explosion => {
            const now = performance.now();
            const elapsed = now - explosion.startTime;
            const progress = elapsed / explosion.duration;
            if (progress >= 1) return;

            ctx.save();
            ctx.translate(explosion.x, explosion.y);

            // Particle debris
            ctx.globalAlpha = 1 - progress;
            explosion.particles.forEach(p => {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
                gradient.addColorStop(0, explosion.color);
                gradient.addColorStop(0.5, '#f80');
                gradient.addColorStop(1, '#f00');
                ctx.fillStyle = gradient;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                ctx.shadowBlur = 10;
                ctx.shadowColor = explosion.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                ctx.restore();
            });

            ctx.restore();
        });
    }

    render(gameState) {
        if (!gameState) return;
        const { players, projectiles, buildings, world, myUserId, colours, gameOverState } = gameState;
        const localPlayer = players.find(p => p.id === myUserId);
        if (!localPlayer) return;

        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // Camera transform
        const scaleX = cw / 2400;
        const scaleY = ch / 1350;
        const scale = Math.min(scaleX, scaleY);
        const camX = -localPlayer.x * scale + cw / 2;
        const camY = -localPlayer.y * scale + ch / 2;

        ctx.save();
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(0, 0, cw, ch);
        ctx.translate(camX, camY);
        ctx.scale(scale, scale);

        // Draw grid
        this.drawGrid(ctx, world);

        // Draw buildings within dynamic draw-distance
        buildings.forEach(bld => {
            const dx = bld.x + (bld.w / 2) - localPlayer.x;
            const dy = bld.y + (bld.h / 2) - localPlayer.y;
            const distance = Math.hypot(dx, dy);
            if (distance > this.DRAW_DISTANCE) return;

            const bx = bld.x * this.BUILDING_SCALE;
            const by = bld.y * this.BUILDING_SCALE;
            const bw = bld.w * this.BUILDING_SCALE;
            const bh = bld.h * this.BUILDING_SCALE;

            // Base fill
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(bx, by, bw, bh);

            // Pattern lines
            ctx.strokeStyle = bld.color || '#0cf';
            ctx.lineWidth = 2;
            const spacing = 20;

            ctx.beginPath();
            switch (bld.pattern) {
                case 'diagonal':
                    for (let offset = 0; offset <= bw + bh; offset += spacing) {
                        let startX = bx;
                        let startY = by + offset;
                        let endX = bx + offset;
                        let endY = by;
                        if (startY > by + bh) { startX += startY - (by + bh); startY = by + bh; }
                        if (endX > bx + bw) { endY -= endX - (bx + bw); endX = bx + bw; }
                        ctx.moveTo(startX, startY);
                        ctx.lineTo(endX, endY);

                        startY = by + bh - offset;
                        endX = bx + offset;
                        endY = by + bh;
                        if (startY < by) { startX += by - startY; startY = by; }
                        if (endX > bx + bw) { endY -= endX - (bx + bw); endX = bx + bw; }
                        ctx.moveTo(startX, startY);
                        ctx.lineTo(endX, endY);
                    }
                    break;
                case 'horizontal':
                    for (let y = by + spacing; y < by + bh; y += spacing) ctx.moveTo(bx, y), ctx.lineTo(bx + bw, y);
                    break;
                case 'vertical':
                    for (let x = bx + spacing; x < bx + bw; x += spacing) ctx.moveTo(x, by), ctx.lineTo(x, by + bh);
                    break;
                case 'cross':
                    for (let y = by + spacing; y < by + bh; y += spacing) ctx.moveTo(bx, y), ctx.lineTo(bx + bw, y);
                    for (let x = bx + spacing; x < bx + bw; x += spacing) ctx.moveTo(x, by), ctx.lineTo(x, by + bh);
                    break;
            }
            ctx.stroke();

            // Outline
            ctx.strokeStyle = '#0cf';
            ctx.lineWidth = 3;
            ctx.strokeRect(bx, by, bw, bh);
        });

        // Projectiles
        projectiles.forEach(proj => {
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
        this.renderExplosions(ctx, gameState.explosions);

        // Tanks
        players.forEach(tank => {
            if (!tank.isAlive) return;
            const color = colours[tank.colorIndex];
            const isLocal = tank.id === myUserId;
            ctx.save();
            ctx.translate(tank.x, tank.y);
            ctx.rotate(tank.hullAngle);

            // Hull
            ctx.fillStyle = color;
            ctx.strokeStyle = isLocal ? '#fff' : '#334';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(30, 0);
            ctx.lineTo(22, -10);
            ctx.lineTo(-20, -14);
            ctx.lineTo(-24, -8);
            ctx.lineTo(-24, 8);
            ctx.lineTo(-20, 14);
            ctx.lineTo(22, 10);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.restore();

            // Turret & gun
            ctx.save();
            ctx.translate(tank.x, tank.y);
            ctx.rotate(tank.turretAngle);
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
            ctx.fillStyle = '#333';
            ctx.fillRect(16, -8, 56, 16); // Gun barrel
            ctx.strokeRect(16, -8, 56, 16);
            ctx.restore();
        });

        ctx.restore();

        this.updateHUD(players, colours, gameOverState);
    }

    drawGrid(ctx, world) {
        ctx.strokeStyle = 'rgba(0,255,255,0.1)';
        ctx.lineWidth = 1;
        const gridSize = 100;
        for (let x = 0; x < world.width; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, world.height); ctx.stroke();
        }
        for (let y = 0; y < world.height; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(world.width, y); ctx.stroke();
        }
    }

    updateHUD(players, colours, gameOverState) {
        if (!this.hudElement) return;
        let html = '<div class="scoreboard">';
        [...players].sort((a,b)=>b.kills-a.kills).forEach(p=>{
            const color = colours[p.colorIndex];
            html += `<div class="score-row"><span style="color:${color}">${p.name}</span> <span>${p.kills} kills / ${p.deaths} deaths</span></div>`;
        });
        html += '</div>';
        if(gameOverState){
            html += `<div class="game-over">
                        <div style="font-size:24px;margin-bottom:10px;">🏆 GAME OVER 🏆</div>
                        <div style="font-size:18px;">Winner: ${gameOverState.winner}</div>
                    </div>`;
        }
        this.hudElement.innerHTML = html;
    }
}
