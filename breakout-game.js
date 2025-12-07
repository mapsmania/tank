// TripGeo.Client/wwwroot/geobox-assets/games/tankofduty/tankofduty-game.js
// Cleaned version: ALL projectile, explosion, and firing code removed.

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
        this.buildings = [];

        this.localInput = {
            forward: 0,
            turn: 0,
            turretAngle: 0,
            firing: false, // firing is now irrelevant but kept for network compatibility
            seq: 0
        };

        this.lastInputSent = 0;
        this.gameOverState = null;

        this.world = { width: 5760, height: 3240 };

        this.colours = [
            '#0ff', '#f0f', '#ff0', '#0f0',
            '#fa0', '#0af', '#f8a', '#8f8'
        ];

        if (this.isHost)
        {
            this.initBuildings();

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
        }

        this.initPlayers();
        this.setupInputHandlers();
    }

    initBuildings()
    {
        // (same building generation code – unchanged)
        const blockSize = 400;
        const streetWidth = 150;
        const buildingMargin = 20;
        const blocksX = Math.floor(this.world.width / (blockSize + streetWidth));
        const blocksY = Math.floor(this.world.height / (blockSize + streetWidth));
        const offsetX = (this.world.width - (blocksX * (blockSize + streetWidth))) / 2;
        const offsetY = (this.world.height - (blocksY * (blockSize + streetWidth))) / 2;

        for (let bx = 0; bx < blocksX; bx++)
        {
            for (let by = 0; by < blocksY; by++)
            {
                const blockX = offsetX + bx * (blockSize + streetWidth);
                const blockY = offsetY + by * (blockSize + streetWidth);

                if (Math.random() > 0.2)
                {
                    const buildingCount = 2 + Math.floor(Math.random() * 3);

                    for (let i = 0; i < buildingCount; i++)
                    {
                        let bldX, bldY, bldW, bldH;
                        const buildingMargin = 20;

                        if (buildingCount === 2)
                        {
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
                        else
                        {
                            const col = i % 2;
                            const row = Math.floor(i / 2);
                            bldW = (blockSize - buildingMargin * 3) / 2;
                            bldH = (blockSize - buildingMargin * 3) / 2;
                            bldX = blockX + buildingMargin + col * (bldW + buildingMargin);
                            bldY = blockY + buildingMargin + row * (bldH + buildingMargin);
                        }

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
    }

    findSafeSpawnPoint(playerIndex)
    {
        const margin = 300;
        const spawnPositions = [
            { x: margin, y: margin },
            { x: this.world.width - margin, y: margin },
            { x: margin, y: this.world.height - margin },
            { x: this.world.width - margin, y: this.world.height - margin },
            { x: this.world.width / 2, y: margin },
            { x: this.world.width / 2, y: this.world.height - margin },
            { x: margin, y: this.world.height / 2 },
            { x: this.world.width - margin, y: this.world.height / 2 },
        ];

        const basePos = spawnPositions[playerIndex % spawnPositions.length];

        for (let attempt = 0; attempt < 50; attempt++)
        {
            const searchRadius = 200 + attempt * 50;
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * searchRadius;
            const x = basePos.x + Math.cos(angle) * distance;
            const y = basePos.y + Math.sin(angle) * distance;

            if (x < 50 || x > this.world.width - 50 || y < 50 || y > this.world.height - 50)
                continue;

            if (!this.collideWithBuildings(x, y, 30))
                return { x, y };
        }

        return basePos;
    }

    initPlayers()
    {
        const playerList = this.options.players || [];

        playerList.forEach((p, idx) =>
        {
            this.setupPlayer(p.userId, p.userName, idx);
        });

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
        const spawn = this.findSafeSpawnPoint(colorIndex);

        const angle = Math.atan2(
            this.world.height / 2 - spawn.y,
            this.world.width / 2 - spawn.x
        );

        const tank = {
            id,
            name,
            colorIndex: colorIndex % this.colours.length,
            x: spawn.x,
            y: spawn.y,
            hullAngle: angle,
            turretAngle: angle,
            kills: 0,
            deaths: 0,
            isAlive: true,
            respawnAt: 0,
            isLocal: id === this.myUserId
        };

        this.players.set(id, tank);
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

        window.addEventListener('keydown', e =>
        {
            if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code))
            {
                keys.add(e.code);
                updateAxes();
            }
        });

        window.addEventListener('keyup', e =>
        {
            if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code))
            {
                keys.delete(e.code);
                updateAxes();
            }
        });

        window.addEventListener('mousemove', e =>
        {
            const rect = this.renderer.canvas.getBoundingClientRect();
            const tank = this.players.get(this.myUserId);
            if (!tank) return;

            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const worldPos = this.screenToWorld(x, y, tank);

            this.localInput.turretAngle = Math.atan2(worldPos.y - tank.y, worldPos.x - tank.x);

            this.sendInputThrottled();
        });

        // left mouse button no longer fires anything
        window.addEventListener('mousedown', e =>
        {
            if (e.button === 0)
                this.sendInputThrottled(true);
        });

        window.addEventListener('mouseup', e =>
        {
            if (e.button === 0)
                this.sendInputThrottled(true);
        });
    }

    sendInputThrottled(force = false)
    {
        const now = performance.now();
        if (force || now - this.lastInputSent > 50)
        {
            this.lastInputSent = now;

            if (!this.isSinglePlayer)
            {
                this.sendMessage('tank-input', {
                    playerId: this.myUserId,
                    forward: this.localInput.forward,
                    turn: this.localInput.turn,
                    turretAngle: this.localInput.turretAngle,
                    firing: false // always false now
                });
            }
        }
    }

    screenToWorld(screenX, screenY, tank)
    {
        const canvas = this.renderer.canvas;
        const cw = canvas.width;
        const ch = canvas.height;

        const scaleX = cw / 2400;
        const scaleY = ch / 1350;
        const scale = Math.min(scaleX, scaleY);

        const camX = -tank.x * scale + cw / 2;
        const camY = -tank.y * scale + ch / 2;

        return {
            x: (screenX - camX) / scale,
            y: (screenY - camY) / scale
        };
    }

    update(deltaTime)
    {
        if (this.gameOverState) return;

        const dt = Math.min(deltaTime, 0.1);

        this.players.forEach((tank) =>
        {
            if (!tank.isAlive)
                return;

            const input = tank.isLocal ? this.localInput : tank.remoteInput || {};

            const speed = 320;
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
        });

        if (!this.isSinglePlayer)
            this.broadcastStateThrottled();
    }

    collideWithBuildings(x, y, radius)
    {
        return this.buildings.some(bld =>
        {
            const closestX = Math.max(bld.x, Math.min(x, bld.x + bld.w));
            const closestY = Math.max(bld.y, Math.min(y, bld.y + bld.h));
            return Math.hypot(x - closestX, y - closestY) < radius;
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
                this.buildings = data.buildings || [];
                this.world = data.worldSize || this.world;
                break;

            case 'tank-join':
                if (!this.players.has(data.playerId))
                    this.setupPlayer(data.playerId, data.name, data.colorIndex);

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
                        firing: false
                    };
                }
                break;

            case 'tank-state-update':
                data.players.forEach(pd =>
                {
                    const tank = this.players.get(pd.id);
                    if (!tank || tank.isLocal) return;

                    const jump = Math.hypot(pd.x - tank.x, pd.y - tank.y) > 500;

                    if (jump)
                    {
                        tank.x = pd.x;
                        tank.y = pd.y;
                    }
                    else
                    {
                        tank.x = tank.x * 0.7 + pd.x * 0.3;
                        tank.y = tank.y * 0.7 + pd.y * 0.3;
                    }

                    tank.hullAngle = pd.hullAngle;
                    tank.turretAngle = pd.turretAngle;
                });
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

        this.gameOverState = null;
    }

    getGameState()
    {
        return {
            players: Array.from(this.players.values()),
            buildings: this.buildings,
            world: this.world,
            myUserId: this.myUserId,
            colours: this.colours,
            gameOverState: this.gameOverState
        };
    }

    dispose()
    {
        if (this.cleanupInputs)
            this.cleanupInputs();

        this.players.clear();
    }
}
