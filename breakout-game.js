// TripGeo.Client/wwwroot/geobox-assets/games/tankofduty/tankofduty-game.js
// Converted to a simple racing game with destination point

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

        // INPUT NOW ONLY HAS MOVEMENT
        this.localInput = {
            forward: 0,
            turn: 0,
            seq: 0
        };

        this.lastInputSent = 0;
        this.gameOverState = null;

        this.world = { width: 5760, height: 3240 };

        this.colours = [
            '#0ff', '#f0f', '#ff0', '#0f0',
            '#fa0', '#0af', '#f8a', '#8f8'
        ];

        // Racing destination point
        this.destinationPoint = null;

        if (this.isHost)
        {
            this.initBuildings();
            this.generateDestinationPoint();

            if (!this.isSinglePlayer)
            {
                setTimeout(() =>
                {
                    this.broadcastMessage("race-map-init", {
                        buildings: this.buildings,
                        world: this.world,
                        destination: this.destinationPoint
                    });
                }, 50);
            }
        }

        this.initPlayers();
        this.setupInputHandlers();

        console.log("[TankGame - Racing] Initialized");
    }

    generateDestinationPoint()
    {
        // Set a destination in a random street area (not inside buildings)
        for (let i = 0; i < 100; i++)
        {
            const x = Math.random() * this.world.width;
            const y = Math.random() * this.world.height;

            if (!this.collideWithBuildings(x, y, 40))
            {
                this.destinationPoint = { x, y };
                return;
            }
        }

        // Fallback center
        this.destinationPoint = {
            x: this.world.width / 2,
            y: this.world.height / 2
        };
    }

    initBuildings()
    {
        // same generation as before – unchanged
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
                    const count = 2 + Math.floor(Math.random() * 3);

                    for (let i = 0; i < count; i++)
                    {
                        let bldX, bldY, bldW, bldH;

                        if (count === 2)
                        {
                            if (Math.random() > 0.5)
                            {
                                bldW = blockSize - buildingMargin * 2;
                                bldH = (blockSize - buildingMargin * 3) / 2;
                                bldX = blockX + buildingMargin;
                                bldY = blockY + buildingMargin + i * (bldH + buildingMargin);
                            } else
                            {
                                bldW = (blockSize - buildingMargin * 3) / 2;
                                bldH = blockSize - buildingMargin * 2;
                                bldX = blockX + buildingMargin + i * (bldW + buildingMargin);
                                bldY = blockY + buildingMargin;
                            }
                        }
                        else if (count === 3)
                        {
                            if (i === 0)
                            {
                                bldW = (blockSize - buildingMargin * 3) / 2;
                                bldH = blockSize - buildingMargin * 2;
                                bldX = blockX + buildingMargin;
                                bldY = blockY + buildingMargin;
                            } else
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

                        this.buildings.push({ x: bldX, y: bldY, w: bldW, h: bldH });
                    }
                }
            }
        }
    }

    findSafeSpawnPoint(index)
    {
        const margin = 300;
        const positions = [
            { x: margin, y: margin },
            { x: this.world.width - margin, y: margin },
            { x: margin, y: this.world.height - margin },
            { x: this.world.width - margin, y: this.world.height - margin }
        ];

        const base = positions[index % positions.length];

        for (let attempt = 0; attempt < 40; attempt++)
        {
            const r = 200 + attempt * 40;
            const ang = Math.random() * Math.PI * 2;
            const x = base.x + Math.cos(ang) * r;
            const y = base.y + Math.sin(ang) * r;

            if (!this.collideWithBuildings(x, y, 40))
                return { x, y };
        }

        return base;
    }

    initPlayers()
    {
        const list = this.options.players || [];

        list.forEach((p, idx) =>
        {
            this.setupPlayer(p.userId, p.userName, idx);
        });

        if (!this.isSinglePlayer)
        {
            setTimeout(() =>
            {
                this.sendMessage('race-join', {
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

        const car = {
            id,
            name,
            colorIndex: colorIndex % this.colours.length,
            x: spawn.x,
            y: spawn.y,
            angle: Math.random() * Math.PI * 2,
            speed: 0,
            isLocal: id === this.myUserId
        };

        this.players.set(id, car);
    }

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

        const kd = e =>
        {
            if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code))
            {
                keys.add(e.code);
                update();
            }
        };
        const ku = e =>
        {
            if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code))
            {
                keys.delete(e.code);
                update();
            }
        };

        window.addEventListener("keydown", kd);
        window.addEventListener("keyup", ku);

        this.cleanupInputs = () =>
        {
            window.removeEventListener("keydown", kd);
            window.removeEventListener("keyup", ku);
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
                this.sendMessage('race-input', {
                    playerId: this.myUserId,
                    forward: this.localInput.forward,
                    turn: this.localInput.turn
                });
            }
        }
    }

    update(deltaTime)
    {
        if (this.gameOverState) return;

        const dt = Math.min(deltaTime, 0.1);

        this.players.forEach(car =>
        {
            const input = car.isLocal ? this.localInput : car.remoteInput || {};

            // Racing physics
            const accel = 300;
            const brake = 200;
            const maxSpeed = 600;
            const turnRate = 2.3;

            if (input.forward > 0)
            {
                car.speed += accel * dt;
            }
            else if (input.forward < 0)
            {
                car.speed -= brake * dt;
            }
            else
            {
                car.speed *= 0.95;
            }

            car.speed = Math.max(-200, Math.min(maxSpeed, car.speed));

            car.angle += (input.turn || 0) * turnRate * dt;

            const nx = car.x + Math.cos(car.angle) * car.speed * dt;
            const ny = car.y + Math.sin(car.angle) * car.speed * dt;

            if (!this.collideWithBuildings(nx, ny, 20))
            {
                car.x = nx;
                car.y = ny;
            }
            else
            {
                car.speed *= 0.4;
            }

            // Destination check
            if (this.destinationPoint)
            {
                if (Math.hypot(car.x - this.destinationPoint.x, car.y - this.destinationPoint.y) < 70)
                {
                    this.endRace(car);
                }
            }
        });

        if (!this.isSinglePlayer)
            this.broadcastStateThrottled();
    }

    endRace(winner)
    {
        this.gameOverState = {
            winner: winner.name,
            id: winner.id
        };

        if (!this.isSinglePlayer)
        {
            this.broadcastMessage("race-finished", this.gameOverState);
        }
    }

    collideWithBuildings(x, y, radius)
    {
        return this.buildings.some(b =>
        {
            const cx = Math.max(b.x, Math.min(x, b.x + b.w));
            const cy = Math.max(b.y, Math.min(y, b.y + b.h));
            return Math.hypot(x - cx, y - cy) < radius;
        });
    }

    broadcastStateThrottled()
    {
        const now = performance.now();
        if (!this.lastStateBroadcast || now - this.lastStateBroadcast > 200)
        {
            this.lastStateBroadcast = now;

            this.broadcastMessage("race-state-update", {
                players: Array.from(this.players.values())
            });
        }
    }

    handleMessage(type, data)
    {
        switch (type)
        {
            case "race-map-init":
                this.buildings = data.buildings;
                this.world = data.world;
                this.destinationPoint = data.destination;
                break;

            case "race-join":
                if (!this.players.has(data.playerId))
                    this.setupPlayer(data.playerId, data.name, data.colorIndex);

                if (this.isHost)
                {
                    this.broadcastMessage("race-map-init", {
                        buildings: this.buildings,
                        world: this.world,
                        destination: this.destinationPoint
                    });
                }
                break;

            case "race-input":
                const car = this.players.get(data.playerId);
                if (car && !car.isLocal)
                {
                    car.remoteInput = {
                        forward: data.forward,
                        turn: data.turn
                    };
                }
                break;

            case "race-state-update":
                data.players.forEach(p =>
                {
                    const car = this.players.get(p.id);
                    if (car && !car.isLocal)
                    {
                        car.x = car.x * 0.7 + p.x * 0.3;
                        car.y = car.y * 0.7 + p.y * 0.3;
                        car.angle = p.angle;
                        car.speed = p.speed;
                    }
                });
                break;

            case "race-finished":
                this.gameOverState = data;
                break;
        }
    }

    getGameState()
    {
        return {
            players: Array.from(this.players.values()),
            buildings: this.buildings,
            world: this.world,
            destination: this.destinationPoint,
            gameOverState: this.gameOverState
        };
    }

    dispose()
    {
        if (this.cleanupInputs) this.cleanupInputs();
        this.players.clear();
    }
}
