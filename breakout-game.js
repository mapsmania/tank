// TripGeo.Client/wwwroot/geobox-assets/games/racing/racing-game.js
// Racing game logic using WebRTC peer-to-peer synchronization
// ⭐ Modified from Tank of Duty — all combat removed, goal-based racing gameplay added.

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

        // ⭐ Simplified input: just forward/back & turning
        this.localInput = {
            forward: 0,
            turn: 0,
            seq: 0
        };

        this.lastInputSent = 0;
        this.gameOverState = null;

        // ⭐ Racing destination point
        this.destination = { x: 3000, y: 1600 };

        // 3x3 map area
        this.world = { width: 5760, height: 3240 };

        // Vehicle colours
        this.colours = ['#0ff', '#f0f', '#ff0', '#0f0', '#fa0', '#0af', '#f8a', '#8f8'];

        // Host generates buildings & broadcasts map
        if (this.isHost)
        {
            this.initBuildings();

            if (!this.isSinglePlayer)
            {
                setTimeout(() =>
                {
                    this.broadcastMessage("race-map-init", {
                        buildings: this.buildings,
                        worldSize: this.world,
                        destination: this.destination
                    });
                }, 50);
            }
        }

        this.initPlayers();
        this.setupInputHandlers();

        console.log("[RacingGame] Initialized");
    }

    // Same building-generation as Tank game
    initBuildings()
    {
        const blockSize = 400;
        const streetWidth = 150;
        const buildingMargin = 20;

        const blocksX = Math.floor(this.world.width / (blockSize + streetWidth));
        const blocksY = Math.floor(this.world.height / (blockSize + streetWidth));

        const offsetX = (this.world.width - blocksX * (blockSize + streetWidth)) / 2;
        const offsetY = (this.world.height - blocksY * (blockSize + streetWidth)) / 2;

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

                        this.buildings.push({
                            x: bldX,
                            y: bldY,
                            w: bldW,
                            h: bldH,
                            color: "#888"
                        });
                    }
                }
            }
        }
    }

    findSafeSpawnPoint(index)
    {
        const margin = 300;
        const spawnPositions = [
            { x: margin, y: margin },
            { x: this.world.width - margin, y: margin },
            { x: margin, y: this.world.height - margin },
            { x: this.world.width - margin, y: this.world.height - margin }
        ];
        return spawnPositions[index % spawnPositions.length];
    }

    initPlayers()
    {
        const list = this.options.players || [];
        list.forEach((p, idx) => this.setupPlayer(p.userId, p.userName, idx));

        if (!this.isSinglePlayer)
        {
            setTimeout(() =>
            {
                this.sendMessage("race-join", {
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

        const vehicle = {
            id,
            name,
            x: spawn.x,
            y: spawn.y,
            angle: 0,
            colorIndex: colorIndex % this.colours.length,
            isLocal: id === this.myUserId,
            remoteInput: null
        };

        this.players.set(id, vehicle);
    }

    // ⭐ Only W/A/S/D for vehicle control, no mouse needed
    setupInputHandlers()
    {
        const keys = new Set();

        const update = () =>
        {
            this.localInput.forward =
                (keys.has("KeyW") ? 1 : 0) +
                (keys.has("KeyS") ? -1 : 0);

            this.localInput.turn =
                (keys.has("KeyD") ? 1 : 0) +
                (keys.has("KeyA") ? -1 : 0);

            this.sendInputThrottled();
        };

        const down = (e) =>
        {
            if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code))
            {
                keys.add(e.code);
                update();
            }
        };

        const up = (e) =>
        {
            if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code))
            {
                keys.delete(e.code);
                update();
            }
        };

        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);

        this.cleanupInputs = () =>
        {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };
    }

    sendInputThrottled(force = false)
    {
        const now = performance.now();
        if (force || now - this.lastInputSent > 50)
        {
            this.lastInputSent = now;

            if (!this.isSinglePlayer)
            {
                this.sendMessage("race-input", {
                    playerId: this.myUserId,
                    forward: this.localInput.forward,
                    turn: this.localInput.turn
                });
            }
        }
    }

    update(delta)
    {
        if (this.gameOverState) return;

        const dt = Math.min(delta, 0.1);

        // ⭐ Movement only
        this.players.forEach((v) =>
        {
            const input = v.isLocal ? this.localInput : v.remoteInput || {};

            const speed = 260;
            const turnRate = 2.8;

            v.angle += (input.turn || 0) * turnRate * dt;
            const forward = (input.forward || 0) * speed * dt;

            const nx = v.x + Math.cos(v.angle) * forward;
            const ny = v.y + Math.sin(v.angle) * forward;

            if (!this.collideWithBuildings(nx, ny, 26))
            {
                v.x = nx;
                v.y = ny;
            }

            // ⭐ Check finish line
            const distToGoal = Math.hypot(v.x - this.destination.x, v.y - this.destination.y);
            if (distToGoal < 100)
            {
                this.finishRace(v);
            }
        });

        if (!this.isSinglePlayer)
        {
            this.broadcastStateThrottled();
        }
    }

    finishRace(winner)
    {
        this.gameOverState = {
            winner: winner.name,
            winnerId: winner.id
        };

        if (!this.isSinglePlayer)
        {
            this.broadcastMessage("race-game-over", this.gameOverState);
        }
    }

    collideWithBuildings(x, y, radius)
    {
        return this.buildings.some((b) =>
        {
            const cx = Math.max(b.x, Math.min(x, b.x + b.w));
            const cy = Math.max(b.y, Math.min(y, b.y + b.h));
            return Math.hypot(x - cx, y - cy) < radius;
        });
    }

    broadcastStateThrottled()
    {
        const now = performance.now();
        if (!this.lastStateBroadcast || now - this.lastStateBroadcast > 120)
        {
            this.lastStateBroadcast = now;

            this.broadcastMessage("race-state-update", {
                players: Array.from(this.players.values()).map(v => ({
                    id: v.id,
                    x: v.x,
                    y: v.y,
                    angle: v.angle
                }))
            });
        }
    }

    handleMessage(type, data)
    {
        switch (type)
        {
            case "race-map-init":
                this.buildings = data.buildings;
                this.world = data.worldSize;
                this.destination = data.destination;
                break;

            case "race-join":
                if (!this.players.has(data.playerId))
                {
                    this.setupPlayer(data.playerId, data.name, data.colorIndex);
                }
                break;

            case "race-input":
                const v = this.players.get(data.playerId);
                if (v && !v.isLocal)
                {
                    v.remoteInput = {
                        forward: data.forward,
                        turn: data.turn
                    };
                }
                break;

            case "race-state-update":
                data.players.forEach(pd =>
                {
                    const v = this.players.get(pd.id);
                    if (v && !v.isLocal)
                    {
                        v.x = v.x * 0.7 + pd.x * 0.3;
                        v.y = v.y * 0.7 + pd.y * 0.3;
                        v.angle = pd.angle;
                    }
                });
                break;

            case "race-game-over":
                this.gameOverState = data;
                break;
        }
    }

    dispose()
    {
        if (this.cleanupInputs)
        {
            this.cleanupInputs();
        }
    }
}
