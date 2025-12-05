// tankofduty-standalone.js
// Standalone version using TripGeo TeamHub (like Battleships)

import { TankGame } from './breakout-game.js';
import { TankRenderer } from './breakout-renderer.js';
import { TankSoundManager } from './breakout-sound.js';

let gameInstance = null;
let renderer = null;
let soundManager = null;
let animationFrameId = null;
let resizeObserver = null;
let multiplayerManager = null;

// TeamHub multiplayer manager (matches Battleships approach)
class TeamHubMultiplayer
{
    constructor()
    {
        this.connection = null;
        this.peerConnections = new Map();
        this.dataChannels = new Map();
        this.handlers = new Map();
        this.localUserId = null;
        this.sessionId = null;
        this.isHost = false;
        this.onPeerReady = null; // Callback for when first peer is ready
        this.hasFiredPeerReady = false; // Only fire once

        // WebRTC configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }

    async connect(sessionId, userId, username, isHost)
    {
        this.sessionId = sessionId;
        this.localUserId = userId;
        this.isHost = isHost; // Will be updated based on who's already in session

        console.log(`[TeamHub-MP] Connecting to TeamHub, session: ${sessionId}, user: ${userId}`);

        // HARDCODED TeamHub URL (like Battleships does with apiUrl)
        // Change this to your server URL
        const apiUrl = "https://api.tripgeo.com/";
        // const apiUrl = "https://localhost:7209/";  // For local testing

        const hubUrl = apiUrl + `teamhub?userid=${this.localUserId}&teamid=tankofduty_${sessionId}`;

        // Create SignalR connection to TeamHub (exactly like Battleships)
        this.connection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl)
            .withAutomaticReconnect()
            .build();

        // Track if we've seen any existing peers
        let hasExistingPeers = false;

        // Setup SignalR event handlers BEFORE starting
        this.setupSignalRHandlers();

        // Add one-time handler to detect existing peers
        const existingPeerHandler = (userName, peerUserId) =>
        {
            hasExistingPeers = true;
            console.log(`[TeamHub-MP] Detected existing peer ${peerUserId} - we are NOT host`);
        };
        this.connection.on('WebRTCPeerJoined', existingPeerHandler);

        // Start connection
        await this.connection.start();
        console.log('[TeamHub-MP] SignalR connected to TeamHub');

        // Join WebRTC session (like Battleships does)
        await this.connection.invoke('JoinWebRTCSession', `tankofduty_${sessionId}`, parseInt(userId));

        // Small delay to receive existing peer notifications
        await new Promise(resolve => setTimeout(resolve, 200));

        // Update host status based on whether we saw existing peers
        this.isHost = !hasExistingPeers;
        console.log(`[TeamHub-MP] Host status: ${this.isHost ? 'HOST' : 'CLIENT'}`);
        console.log('[TeamHub-MP] Joined WebRTC session');

        return this.isHost; // Return host status
    }

    setupSignalRHandlers()
    {
        // Handle WebRTC peer joined
        this.connection.on('WebRTCPeerJoined', (userName, peerUserId) =>
        {
            console.log(`[TeamHub-MP] Peer joined: ${userName} (${peerUserId})`);

            if (peerUserId.toString() === this.localUserId.toString())
            {
                console.log('[TeamHub-MP] Ignoring self');
                return;
            }

            // Lower ID initiates connection (avoid double connections)
            const shouldInitiate = parseInt(this.localUserId) < parseInt(peerUserId);
            if (shouldInitiate)
            {
                console.log(`[TeamHub-MP] Initiating connection to ${peerUserId}`);
                this.createPeerConnection(peerUserId.toString(), true);
            } else
            {
                console.log(`[TeamHub-MP] Waiting for connection from ${peerUserId}`);
            }
        });

        // Handle WebRTC signaling messages (TeamHub sends WebRTCSignalingMessageReceived)
        this.connection.on('WebRTCSignalingMessageReceived', (fromUserId, messageType, messageData) =>
        {
            console.log(`[TeamHub-MP] Signaling from ${fromUserId}: ${messageType}`);
            this.handleSignalingMessage(fromUserId.toString(), messageType, messageData);
        });

        // Handle peer left
        this.connection.on('WebRTCPeerLeft', (peerUserId) =>
        {
            console.log(`[TeamHub-MP] Peer left: ${peerUserId}`);
            this.closePeerConnection(peerUserId.toString());
        });
    }

    async createPeerConnection(remoteUserId, isInitiator)
    {
        console.log(`[TeamHub-MP] Creating peer connection to ${remoteUserId}, initiator: ${isInitiator}`);

        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peerConnections.set(remoteUserId, pc);

        // ICE candidate handling
        pc.onicecandidate = (event) =>
        {
            if (event.candidate)
            {
                console.log(`[TeamHub-MP] Sending ICE candidate to ${remoteUserId}`);
                this.sendSignalingMessage(remoteUserId, 'ice-candidate', JSON.stringify(event.candidate));
            }
        };

        // Connection state changes
        pc.onconnectionstatechange = () =>
        {
            console.log(`[TeamHub-MP] Connection state with ${remoteUserId}: ${pc.connectionState}`);
            if (pc.connectionState === 'connected')
            {
                console.log(`[TeamHub-MP] ✅ Connected to ${remoteUserId}`);
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
            {
                this.closePeerConnection(remoteUserId);
            }
        };

        // ICE connection state
        pc.oniceconnectionstatechange = () =>
        {
            console.log(`[TeamHub-MP] ICE state with ${remoteUserId}: ${pc.iceConnectionState}`);
        };

        if (isInitiator)
        {
            // Create data channel
            const dataChannel = pc.createDataChannel('tank-game', {
                ordered: false,
                maxRetransmits: 0
            });
            this.setupDataChannel(dataChannel, remoteUserId);

            // Create and send offer
            try
            {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                console.log(`[TeamHub-MP] Sending offer to ${remoteUserId}`);
                this.sendSignalingMessage(remoteUserId, 'offer', JSON.stringify(offer));
            } catch (err)
            {
                console.error(`[TeamHub-MP] Error creating offer:`, err);
            }
        } else
        {
            // Wait for data channel from remote
            pc.ondatachannel = (event) =>
            {
                console.log(`[TeamHub-MP] Received data channel from ${remoteUserId}`);
                this.setupDataChannel(event.channel, remoteUserId);
            };
        }
    }

    setupDataChannel(dataChannel, remoteUserId)
    {
        console.log(`[TeamHub-MP] Setting up data channel with ${remoteUserId}`);

        dataChannel.onopen = () =>
        {
            console.log(`[TeamHub-MP] 🎮 Data channel opened with ${remoteUserId} - ready to play!`);
            this.dataChannels.set(remoteUserId, dataChannel);

            // Fire onPeerReady callback once (for host to broadcast map)
            if (!this.hasFiredPeerReady && this.onPeerReady)
            {
                this.hasFiredPeerReady = true;
                console.log('[TeamHub-MP] First peer ready, triggering callback');
                this.onPeerReady();
            }
        };

        dataChannel.onclose = () =>
        {
            console.log(`[TeamHub-MP] Data channel closed with ${remoteUserId}`);
            this.dataChannels.delete(remoteUserId);
        };

        dataChannel.onmessage = (event) =>
        {
            try
            {
                const data = JSON.parse(event.data);
                console.log(`[TeamHub-MP] 📨 Received ${data.type} from ${remoteUserId}`);
                this.handleGameMessage(data.type, data.payload);
            } catch (err)
            {
                console.error('[TeamHub-MP] Failed to parse message:', err);
            }
        };

        dataChannel.onerror = (error) =>
        {
            console.error(`[TeamHub-MP] Data channel error with ${remoteUserId}:`, error);
        };
    }

    async handleSignalingMessage(fromUserId, messageType, messageDataStr)
    {
        let pc = this.peerConnections.get(fromUserId);

        // If we don't have a connection yet, create one
        if (!pc)
        {
            console.log(`[TeamHub-MP] Creating peer connection for incoming ${messageType}`);
            await this.createPeerConnection(fromUserId, false);
            pc = this.peerConnections.get(fromUserId);
        }

        try
        {
            const messageData = JSON.parse(messageDataStr);

            switch (messageType)
            {
                case 'offer':
                    console.log(`[TeamHub-MP] Processing offer from ${fromUserId}`);
                    await pc.setRemoteDescription(new RTCSessionDescription(messageData));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    this.sendSignalingMessage(fromUserId, 'answer', JSON.stringify(answer));
                    break;

                case 'answer':
                    console.log(`[TeamHub-MP] Processing answer from ${fromUserId}`);
                    await pc.setRemoteDescription(new RTCSessionDescription(messageData));
                    break;

                case 'ice-candidate':
                    console.log(`[TeamHub-MP] Processing ICE candidate from ${fromUserId}`);
                    await pc.addIceCandidate(new RTCIceCandidate(messageData));
                    break;

                default:
                    console.warn('[TeamHub-MP] Unknown signaling type:', messageType);
            }
        } catch (err)
        {
            console.error('[TeamHub-MP] Error handling signaling:', err);
        }
    }

    sendSignalingMessage(toUserId, messageType, messageData)
    {
        if (!this.connection)
        {
            console.error('[TeamHub-MP] No SignalR connection');
            return;
        }

        // Use TeamHub's SendWebRTCSignalingMessage (targetUserId as STRING)
        this.connection.invoke('SendWebRTCSignalingMessage', toUserId.toString(), messageType, messageData)
            .catch(err => console.error('[TeamHub-MP] Failed to send signaling:', err));
    }

    // Send game message to all connected peers
    send(messageType, payload)
    {
        const message = JSON.stringify({ type: messageType, payload });
        console.log(`[TeamHub-MP] Sending ${messageType} to ${this.dataChannels.size} peers`);

        this.dataChannels.forEach((channel, userId) =>
        {
            console.log(`[TeamHub-MP] Channel to ${userId} state: ${channel.readyState}`);
            if (channel.readyState === 'open')
            {
                try
                {
                    channel.send(message);
                    console.log(`[TeamHub-MP] ✅ Sent ${messageType} to ${userId}`);
                } catch (err)
                {
                    console.error(`[TeamHub-MP] Failed to send to ${userId}:`, err);
                }
            } else
            {
                console.warn(`[TeamHub-MP] Channel to ${userId} not open (${channel.readyState})`);
            }
        });
    }

    // Broadcast to all peers
    broadcast(messageType, payload)
    {
        console.log(`[TeamHub-MP] Broadcasting ${messageType}`);
        this.send(messageType, payload);
    }

    // Handle incoming game message
    handleGameMessage(messageType, payload)
    {
        const handler = this.handlers.get(messageType);
        if (handler)
        {
            handler(payload);
        }
    }

    // Register message handler
    on(messageType, handler)
    {
        this.handlers.set(messageType, handler);
    }

    closePeerConnection(userId)
    {
        const pc = this.peerConnections.get(userId);
        if (pc)
        {
            pc.close();
            this.peerConnections.delete(userId);
        }

        const dc = this.dataChannels.get(userId);
        if (dc)
        {
            dc.close();
            this.dataChannels.delete(userId);
        }

        console.log(`[TeamHub-MP] Closed connection to ${userId}`);
    }

    async disconnect()
    {
        console.log('[TeamHub-MP] Disconnecting...');

        // Close all peer connections
        this.peerConnections.forEach((pc, userId) =>
        {
            this.closePeerConnection(userId);
        });

        // Leave WebRTC session
        if (this.connection)
        {
            try
            {
                await this.connection.invoke('LeaveWebRTCSession', `tankofduty_${this.sessionId}`);
                await this.connection.stop();
            } catch (err)
            {
                console.error('[TeamHub-MP] Error disconnecting:', err);
            }
            this.connection = null;
        }

        this.handlers.clear();
        console.log('[TeamHub-MP] Disconnected');
    }
}

// Initialize game
export async function initTankOfDutyStandalone(options)
{
    console.log('[TankOfDuty] Initializing standalone version with TeamHub', options);

    const canvas = document.getElementById(options.canvasId);
    const hudElement = document.getElementById(options.hudId);

    if (!canvas || !hudElement)
    {
        throw new Error('Canvas or HUD element not found');
    }

    // Initialize sound manager
    soundManager = new TankSoundManager();
    soundManager.initSounds();

    // Initialize renderer
    renderer = new TankRenderer(canvas, hudElement);

    // Setup multiplayer if not single player
    let sendMessage, broadcastMessage;

    if (!options.isSinglePlayer && options.sessionId)
    {
        console.log('[TankOfDuty] Setting up TeamHub multiplayer...');

        multiplayerManager = new TeamHubMultiplayer();

        // Define message functions FIRST (before handlers need them)
        sendMessage = (type, payload) =>
        {
            if (multiplayerManager)
            {
                multiplayerManager.send(type, payload);
            }
        };
        broadcastMessage = (type, payload) =>
        {
            if (multiplayerManager)
            {
                multiplayerManager.broadcast(type, payload);
            }
        };

        // CRITICAL: Register message handlers BEFORE connecting
        // Messages can arrive during connection setup!
        let pendingMessages = []; // Queue messages until game is ready

        multiplayerManager.on('tank-map-init', (data) =>
        {
            if (!gameInstance)
            {
                // First time receiving map - initialize game with received data
                console.log('[TankOfDuty] Received map from host, initializing game...');
                gameInstance = new TankGame(options, renderer, sendMessage, broadcastMessage, soundManager);
                gameInstance.handleMessage('tank-map-init', data);

                // Setup existing players from host (including getting our own color)
                let myAssignedColor = null;
                if (data.existingPlayers)
                {
                    console.log(`[TankOfDuty] Setting up ${data.existingPlayers.length} existing players with host-assigned colors`);

                    data.existingPlayers.forEach(playerInfo =>
                    {
                        if (playerInfo.playerId === options.myUserId)
                        {
                            // Save our color assignment from host
                            myAssignedColor = playerInfo.colorIndex;
                            const myTank = gameInstance.players.get(options.myUserId);
                            if (myTank)
                            {
                                myTank.colorIndex = playerInfo.colorIndex;
                                console.log(`[TankOfDuty] My assigned color is index ${playerInfo.colorIndex}`);
                            }
                        } else
                        {
                            // Setup other players with host-assigned colors
                            gameInstance.setupPlayer(playerInfo.playerId, playerInfo.name, playerInfo.colorIndex);
                        }
                    });
                }

                // Send tank-join WITHOUT colorIndex - host will assign it
                setTimeout(() =>
                {
                    sendMessage('tank-join', {
                        playerId: options.myUserId,
                        name: options.myUsername
                        // NO colorIndex - host assigns
                    });
                }, 100);

                // Process any queued messages
                console.log(`[TankOfDuty] Processing ${pendingMessages.length} queued messages...`);
                pendingMessages.forEach(msg =>
                {
                    gameInstance.handleMessage(msg.type, msg.data);
                });
                pendingMessages = [];
            } else
            {
                gameInstance.handleMessage('tank-map-init', data);
            }
        });

        multiplayerManager.on('tank-join', (data) =>
        {
            if (!gameInstance)
            {
                console.log('[TankOfDuty] Queuing tank-join message (game not ready yet)');
                pendingMessages.push({ type: 'tank-join', data });
            } else
            {
                // HOST: Assign color based on current player count
                if (options.isHost && !gameInstance.players.has(data.playerId))
                {
                    const assignedColorIndex = gameInstance.players.size; // Next available color
                    console.log(`[TankOfDuty] HOST: Assigning color ${assignedColorIndex} to player ${data.playerId}`);

                    // Broadcast with host-assigned color to ALL players
                    broadcastMessage('tank-join', {
                        playerId: data.playerId,
                        name: data.name,
                        colorIndex: assignedColorIndex
                    });

                    // Setup player with assigned color
                    gameInstance.setupPlayer(data.playerId, data.name, assignedColorIndex);
                } else
                {
                    // CLIENT: Receive color assignment
                    // CRITICAL: If this is MY tank, update MY color
                    if (data.playerId === options.myUserId)
                    {
                        const myTank = gameInstance.players.get(options.myUserId);
                        if (myTank && data.colorIndex !== undefined)
                        {
                            console.log(`[TankOfDuty] CLIENT: Updating MY color from ${myTank.colorIndex} to ${data.colorIndex}`);
                            myTank.colorIndex = data.colorIndex;
                        }
                    } else
                    {
                        // Other player joining
                        gameInstance.handleMessage('tank-join', data);
                    }
                }
            }
        });

        multiplayerManager.on('tank-input', (data) =>
        {
            if (!gameInstance)
            {
                console.log('[TankOfDuty] Queuing tank-input message (game not ready yet)');
                pendingMessages.push({ type: 'tank-input', data });
            } else
            {
                gameInstance.handleMessage('tank-input', data);
            }
        });

        multiplayerManager.on('tank-state-update', (data) =>
        {
            if (!gameInstance)
            {
                console.log('[TankOfDuty] Queuing tank-state-update message (game not ready yet)');
                pendingMessages.push({ type: 'tank-state-update', data });
            } else
            {
                gameInstance.handleMessage('tank-state-update', data);
            }
        });

        multiplayerManager.on('tank-projectile', (data) =>
        {
            if (!gameInstance)
            {
                pendingMessages.push({ type: 'tank-projectile', data });
            } else
            {
                gameInstance.handleMessage('tank-projectile', data);
            }
        });

        multiplayerManager.on('tank-death', (data) =>
        {
            if (!gameInstance)
            {
                pendingMessages.push({ type: 'tank-death', data });
            } else
            {
                gameInstance.handleMessage('tank-death', data);
            }
        });

        multiplayerManager.on('tank-game-over', (data) =>
        {
            if (!gameInstance)
            {
                pendingMessages.push({ type: 'tank-game-over', data });
            } else
            {
                gameInstance.handleMessage('tank-game-over', data);
            }
        });

        multiplayerManager.on('tank-new-match', (data) =>
        {
            if (!gameInstance)
            {
                pendingMessages.push({ type: 'tank-new-match', data });
            } else
            {
                gameInstance.handleMessage('tank-new-match', data);
            }
        });

        try
        {
            // Connect to TeamHub and get actual host status
            const actualIsHost = await multiplayerManager.connect(
                options.sessionId,
                options.myUserId,
                options.myUsername,
                options.isHost
            );

            // Update options with actual host status
            options.isHost = actualIsHost;
            console.log(`[TankOfDuty] Actual host status: ${actualIsHost ? 'HOST' : 'CLIENT'}`);

            console.log('[TankOfDuty] TeamHub multiplayer connected');
        } catch (err)
        {
            console.error('[TankOfDuty] Multiplayer connection failed:', err);
            throw new Error('Failed to connect to TeamHub: ' + err.message);
        }
    } else
    {
        // Single player - no network
        sendMessage = () => { };
        broadcastMessage = () => { };
    }

    // Initialize game instance
    // For multiplayer, only host initializes immediately
    // Non-host players wait for tank-map-init from host

    if (options.isSinglePlayer || options.isHost)
    {
        gameInstance = new TankGame(options, renderer, sendMessage, broadcastMessage, soundManager);

        // Host: Wait for data channels to be ready, then broadcast map
        if (!options.isSinglePlayer && options.isHost && multiplayerManager)
        {
            console.log('[TankOfDuty] HOST: Waiting for data channels to open...');

            // Listen for when peers are ready
            multiplayerManager.onPeerReady = () =>
            {
                console.log('[TankOfDuty] HOST: Data channel ready, broadcasting map now');

                // Host assigns consistent colors based on player order
                const playersArray = Array.from(gameInstance.players.values());
                const playerColors = {};
                playersArray.forEach((p, index) =>
                {
                    playerColors[p.id] = index; // Host's color index for each player
                });

                broadcastMessage('tank-map-init', {
                    buildings: gameInstance.buildings,
                    worldSize: gameInstance.world,
                    existingPlayers: playersArray.map(p => ({
                        playerId: p.id,
                        name: p.name,
                        colorIndex: playerColors[p.id] // Use host's assigned color
                    }))
                });
            };
        }
    } else
    {
        // Non-host: wait for map initialization from host
        console.log('[TankOfDuty] CLIENT: Waiting for map from host...');
    }

    // Setup resize observer
    const resizeCanvas = () => renderer.resizeCanvas();
    resizeCanvas();
    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    // Start game loop
    let lastFrameTime = performance.now();
    const gameLoop = (timestamp) =>
    {
        const deltaTime = (timestamp - lastFrameTime) / 1000;
        lastFrameTime = timestamp;

        // Only update if game is initialized
        if (gameInstance)
        {
            gameInstance.update(deltaTime);
            renderer.render(gameInstance.getGameState());
        }

        animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);

    console.log('[TankOfDuty] Initialization complete');
}

export function disposeTankOfDuty()
{
    console.log('[TankOfDuty] Disposing');

    if (animationFrameId)
    {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (resizeObserver && renderer?.canvas)
    {
        resizeObserver.unobserve(renderer.canvas);
        resizeObserver = null;
    }

    if (multiplayerManager)
    {
        multiplayerManager.disconnect();
        multiplayerManager = null;
    }

    if (gameInstance)
    {
        gameInstance.dispose();
        gameInstance = null;
    }

    if (soundManager)
    {
        soundManager.dispose();
        soundManager = null;
    }

    renderer = null;
}

export function getSoundManager()
{
    return soundManager;
}
