// wwwroot/js/webrtc.js - Updated WebRTC module for SignalR integration
const WebRTC_P2P = (function ()
{
    'use strict';

    console.log('[WebRTC-Main] WebRTC P2P module loading...');

    // State management
    let teamHubService = null;
    let isInitialized = false;
    let isConnected = false;
    let localUserId = null;
    let sessionId = null;
    let peerConnections = new Map(); // userId -> RTCPeerConnection
    let dataChannels = new Map(); // userId -> RTCDataChannel
    let callbacks = {};

    // WebRTC configuration
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // Initialize WebRTC with existing TeamHubService (SignalR connection)
    function initializeWithSignalR(teamHubServiceRef)
    {
        console.log('[WebRTC-Main] Initializing with SignalR TeamHubService');

        try
        {
            teamHubService = teamHubServiceRef;
            isInitialized = true;

            console.log('[WebRTC-Main] SignalR signaling initialized');
            console.log("teamHubService = " + teamHubService);
            return true;
        } catch (error)
        {
            console.error('[WebRTC-Main] Failed to initialize with SignalR:', error);
            return false;
        }
    }

    // Connect to WebRTC session via SignalR
    async function connectToSession(userId, teamId)
    {
        if (!isInitialized || !teamHubService)
        {
            throw new Error('WebRTC not initialized with SignalR');
        }

        localUserId = userId;
        sessionId = teamId;

        try
        {
            console.log(`[WebRTC-Main] Connecting as ${userId} to session ${teamId}`);

            // Setup event handlers for SignalR WebRTC events
            setupSignalREventHandlers();

            // Join WebRTC session via SignalR (this will trigger the error fix)
            // await teamHubService.invokeMethodAsync('JSInvokableJoinWebRTCSession', teamId, parseInt(userId));
            await teamHubService.invokeMethodAsync('JoinWebRTCSession', teamId, parseInt(userId));

            isConnected = true;
            console.log('[WebRTC-Main] Successfully connected to WebRTC session via SignalR');
            return true;
        } catch (error)
        {
            console.error('[WebRTC-Main] Failed to connect to session:', error);
            isConnected = false;
            return false;
        }
    }

    // Setup SignalR event handlers (connects to TeamHubService events)
    function setupSignalREventHandlers()
    {
        console.log('[WebRTC-Main] Setting up SignalR WebRTC event handlers');

        // Note: These events are handled by the C# TeamHubService and passed to JavaScript
        // We'll handle them via the callback system when SignalR events are received
    }

    // Handle peer joined (called from Blazor when SignalR event received)
    function handlePeerJoined(userName, userId)
    {
        console.log(`[WebRTC-Main] Peer joined: ${userName} (${userId}), localUserId: ${localUserId}`);

        if (userId.toString() === localUserId)
        {
            console.log('[WebRTC-Main] Ignoring self peer joined event');
            return;
        }

        // POLITE PEER: Only the peer LOWER ID initiates
        const shouldInitiate = localUserId && parseInt(localUserId) < parseInt(userId);
        console.log(`[WebRTC-Main] Should initiate connection to ${userId}: ${shouldInitiate} (local: ${localUserId}, remote: ${userId})`);

        

        // Create peer connection (with or without auto-offer)
        createPeerConnection(userId.toString(), shouldInitiate);

        // Trigger callback
        if (callbacks.onPeerJoined)
        {
            callbacks.onPeerJoined(userName, userId);
        }
    }

    // Handle peer left (called from Blazor when SignalR event received)
    function handlePeerLeft(userId)
    {
        console.log(`[WebRTC-Main] Peer left: ${userId}`);

        // Clean up peer connection
        cleanupPeerConnection(userId);

        // Trigger callback
        if (callbacks.onPeerLeft)
        {
            callbacks.onPeerLeft(userId);
        }
    }

    // Handle signaling message (called from Blazor when SignalR event received)
    function handleSignalingMessage(fromUserId, messageType, messageData)
    {
        console.log(`[WebRTC-Main] Signaling message: ${messageType} from ${fromUserId}`);

        try
        {
            // Parse message data if it's JSON string
            let parsedData = messageData;
            if (typeof messageData === 'string')
            {
                try
                {
                    parsedData = JSON.parse(messageData);
                } catch (e)
                {
                    // Keep as string if not JSON
                }
            }

            // Handle different message types
            switch (messageType)
            {
                case 'offer':
                    handleOffer(fromUserId, parsedData);
                    break;
                case 'answer':
                    handleAnswer(fromUserId, parsedData);
                    break;
                case 'ice-candidate':
                    handleIceCandidate(fromUserId, parsedData);
                    break;
                default:
                    console.log(`[WebRTC-Main] Unknown message type: ${messageType}`);
            }
        } catch (error)
        {
            console.error('[WebRTC-Main] Error handling signaling message:', error);
        }
    }

    // Create peer connection
    function createPeerConnection(userId, shouldCreateOffer = false)
    {
        console.log(`[WebRTC-Main] Creating peer connection for user ${userId}, shouldCreateOffer: ${shouldCreateOffer}`);

        if (peerConnections.has(userId))
        {
            console.log(`[WebRTC-Main] Peer connection for ${userId} already exists`);
            return peerConnections.get(userId);
        }

        const peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnections.set(userId, peerConnection);

        // Setup event handlers
        peerConnection.onicecandidate = (event) =>
        {
            if (event.candidate)
            {
                console.log(`[WebRTC-Main] Sending ICE candidate to ${userId}`);
                sendSignalingMessage(userId, 'ice-candidate', event.candidate);
            }
        };

        peerConnection.ondatachannel = (event) =>
        {
            console.log(`[WebRTC-Main] Data channel received from ${userId}`);
            const channel = event.channel;
            setupDataChannel(channel, userId);
        };

        // Fixed connection state handler using GLOBAL pattern
        peerConnection.onconnectionstatechange = () =>
        {
            console.log(`[WebRTC-Main] Connection state changed for ${userId}: ${peerConnection.connectionState}`);

            if (peerConnection.connectionState === 'connected')
            {
                console.log(`[WebRTC-Main] WebRTC P2P connected to ${userId}! Direct browser-to-browser link established.`);

                // USE GLOBAL PATTERN
                if (typeof GLOBAL !== 'undefined' && GLOBAL.DotNetReference)
                {
                    console.log(`[WebRTC-Main] Calling GLOBAL.DotNetReference.HandlePeerConnected for ${userId}`);
                    GLOBAL.DotNetReference.invokeMethodAsync('HandlePeerConnected', userId)
                        .then(() => console.log(`[WebRTC-Main] ✅ Successfully notified Blazor of peer ${userId} connection`))
                        .catch(err => console.error('❌ Error calling HandlePeerConnected:', err));
                }
                else 
                {
                    console.error(`[WebRTC-Main] ❌ GLOBAL.DotNetReference not available!`);
                    console.log('Available:', { GLOBAL: typeof GLOBAL, 'GLOBAL.DotNetReference': typeof GLOBAL?.DotNetReference });
                }

            } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed')
            {
                console.log(`[WebRTC-Main] Peer ${userId} disconnected (state: ${peerConnection.connectionState})`);

                if (typeof GLOBAL !== 'undefined' && GLOBAL.DotNetReference)
                {
                    GLOBAL.DotNetReference.invokeMethodAsync('HandlePeerDisconnected', userId)
                        .catch(err => console.error('Error calling HandlePeerDisconnected:', err));
                }
            }
        };

        // Only create data channel and offer if we're the initiator
        if (shouldCreateOffer)
        {
            console.log(`[WebRTC-Main] Creating data channel and offer for ${userId}`);

            // Create data channel (for outgoing connections)
            const dataChannel = peerConnection.createDataChannel('chat', {
                ordered: true
            });
            setupDataChannel(dataChannel, userId);

            // Start connection process by creating offer
            createOffer(userId);
        }
        else
        {
            console.log(`[WebRTC-Main] Waiting for incoming offer from ${userId}`);
        }

        return peerConnection;
    }

    // Setup data channel
    function setupDataChannel(channel, userId)
    {
        dataChannels.set(userId, channel);

        channel.onopen = () =>
        {
            console.log(`[WebRTC-Main] Data channel opened with ${userId}`);
        };

        channel.onmessage = (event) =>
        {
            console.log(`[WebRTC-Main] Raw message received from ${userId}:`, event.data);

            // USE GLOBAL PATTERN FOR MESSAGES TOO:
            if (typeof GLOBAL !== 'undefined' && GLOBAL.DotNetReference)
            {
                // Parse message and forward to Blazor
                try
                {
                    let message = {
                        type: 'chat',
                        text: event.data.toString(),
                        timestamp: Date.now()
                    };

                    GLOBAL.DotNetReference.invokeMethodAsync('HandleDataChannelMessage', userId, event.data)
                        .then(() => console.log(`[WebRTC-Main] ✅ Message forwarded to Blazor`))
                        .catch(err => console.error('❌ Error forwarding message to Blazor:', err));
                } catch (err)
                {
                    console.error('[WebRTC] Error processing message:', err);
                }
            }
            else
            {
                console.error('[WebRTC] No GLOBAL.DotNetReference available to handle incoming message');
            }
        };

        channel.onclose = () =>
        {
            console.log(`[WebRTC-Main] Data channel closed with ${userId}`);
            dataChannels.delete(userId);
        };
    }

    // Create and send offer
    async function createOffer(userId)
    {
        const peerConnection = peerConnections.get(userId);
        if (!peerConnection) return;

        try
        {
            console.log(`[WebRTC-Main] Creating offer for ${userId}`);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            console.log(`[WebRTC-Main] Sending offer to ${userId}`);
            sendSignalingMessage(userId, 'offer', offer);
        } catch (error)
        {
            console.error(`[WebRTC-Main] Error creating offer for ${userId}:`, error);
        }
    }

    // Handle received offer
    async function handleOffer(fromUserId, offer)
    {
        console.log(`[WebRTC-Main] Handling offer from ${fromUserId}`);

        let peerConnection = peerConnections.get(fromUserId);
        if (!peerConnection)
        {
            // Create connection without auto-offer since we're receiving an offer
            peerConnection = createPeerConnection(fromUserId, false);
        }

        try
        {
            // Check if we're in a valid state to handle the offer
            if (peerConnection.signalingState !== 'stable' && peerConnection.signalingState !== 'have-local-offer')
            {
                console.log(`[WebRTC-Main] Invalid state for handling offer: ${peerConnection.signalingState}, waiting...`);
                // Wait a bit and try again
                setTimeout(() => handleOffer(fromUserId, offer), 100);
                return;
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            console.log(`[WebRTC-Main] Sending answer to ${fromUserId}`);
            sendSignalingMessage(fromUserId, 'answer', answer);
        } catch (error)
        {
            console.error(`[WebRTC-Main] Error handling offer from ${fromUserId}:`, error);

            // Reset connection if it's in a bad state
            if (error.name === 'InvalidStateError')
            {
                console.log(`[WebRTC-Main] Resetting connection for ${fromUserId} due to state error`);
                peerConnections.delete(fromUserId);
                // Don't auto-create offer since we're handling an incoming offer
                setTimeout(() => createPeerConnection(fromUserId, false), 1000);
            }
        }
    }

    // Handle received answer
    async function handleAnswer(fromUserId, answer)
    {
        console.log(`[WebRTC-Main] Handling answer from ${fromUserId}`);

        const peerConnection = peerConnections.get(fromUserId);
        if (!peerConnection)
        {
            console.error(`[WebRTC-Main] No peer connection found for ${fromUserId}`);
            return;
        }

        try
        {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error)
        {
            console.error(`[WebRTC-Main] Error handling answer from ${fromUserId}:`, error);
        }
    }

    // Handle received ICE candidate
    async function handleIceCandidate(fromUserId, candidate)
    {
        console.log(`[WebRTC-Main] Handling ICE candidate from ${fromUserId}`);

        const peerConnection = peerConnections.get(fromUserId);
        if (!peerConnection)
        {
            console.error(`[WebRTC-Main] No peer connection found for ${fromUserId}`);
            return;
        }

        try
        {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error)
        {
            console.error(`[WebRTC-Main] Error adding ICE candidate from ${fromUserId}:`, error);
        }
    }

    // Send signaling message via SignalR
    async function sendSignalingMessage(targetUserId, messageType, messageData)
    {
        if (!teamHubService)
        {
            console.error('[WebRTC-Main] TeamHubService not available for signaling');
            return false;
        }

        try
        {
            console.log(`[WebRTC-Main] Sending ${messageType} to ${targetUserId} via SignalR`);

            // Serialize the message data
            const serializedData = JSON.stringify(messageData);

            // Send via TeamHubService SignalR connection
            await teamHubService.invokeMethodAsync('SendWebRTCSignalingMessage', targetUserId, messageType, serializedData);
            return true;
        } catch (error)
        {
            console.error('[WebRTC-Main] Failed to send signaling message:', error);
            return false;
        }
    }

    // Send data channel message
    function sendDataChannelMessage(targetUserId, message)
    {
        const dataChannel = dataChannels.get(targetUserId);
        if (dataChannel && dataChannel.readyState === 'open')
        {
            dataChannel.send(message);
            console.log(`[WebRTC-Main] Sent data channel message to ${targetUserId}:`, message);
            return true;
        } else
        {
            console.warn(`[WebRTC-Main] Data channel to ${targetUserId} not ready`);
            return false;
        }
    }

    // Broadcast message to all connected peers
    function broadcastMessage(message)
    {
        let sentCount = 0;
        for (const [userId, dataChannel] of dataChannels)
        {
            if (dataChannel.readyState === 'open')
            {
                dataChannel.send(message);
                sentCount++;
            }
        }
        console.log(`[WebRTC-Main] Broadcast message to ${sentCount} peers:`, message);
        return sentCount;
    }

    function handleIncomingDataMessage(fromPeerId, messageObject) 
    {
        var dotNetRef = window.getDotNetReference();
        if (!dotNetRef)
        {
            console.warn('[WebRTC] No .NET reference available to handle incoming message');
            return;
        }

        console.log(`[WebRTC] Received ${messageObject.type} message from ${fromPeerId}:`, messageObject);

        try
        {
            switch (messageObject.type)
            {
                case 'chat':
                    // Call the Blazor component's HandleDataChannelMessage method
                    dotNetRef.invokeMethodAsync('HandleDataChannelMessage', fromPeerId, messageObject.text);
                    break;
                case 'position':
                    // Handle position updates
                    dotNetRef.invokeMethodAsync('HandlePositionUpdate', fromPeerId, messageObject.x, messageObject.y);
                    break;
                case 'interaction':
                    // Handle custom interactions
                    console.log('[WebRTC] Received interaction from', fromPeerId, messageObject);
                    dotNetRef.invokeMethodAsync('HandleInteraction', fromPeerId, messageObject.data);
                    break;
                default:
                    console.log(`[WebRTC] Unknown message type: ${messageObject.type}`, messageObject);
            }
        } catch (error)
        {
            console.error('[WebRTC] Error invoking .NET method:', error);
        }
    }

    // Clean up peer connection
    function cleanupPeerConnection(userId)
    {
        const peerConnection = peerConnections.get(userId);
        const dataChannel = dataChannels.get(userId);

        if (dataChannel)
        {
            dataChannel.close();
            dataChannels.delete(userId);
        }

        if (peerConnection)
        {
            peerConnection.close();
            peerConnections.delete(userId);
        }

        console.log(`[WebRTC-Main] Cleaned up peer connection for ${userId}`);
    }

    // Disconnect from session
    async function disconnect()
    {
        console.log('[WebRTC-Main] Disconnecting from WebRTC session');

        // Clean up all peer connections
        for (const userId of peerConnections.keys())
        {
            cleanupPeerConnection(userId);
        }

        // Leave SignalR session
        if (teamHubService && sessionId)
        {
            try
            {
                await teamHubService.invokeMethodAsync('LeaveWebRTCSession', sessionId);
            } catch (error)
            {
                console.error('[WebRTC-Main] Error leaving WebRTC session:', error);
            }
        }

        isConnected = false;
        localUserId = null;
        sessionId = null;

        console.log('[WebRTC-Main] Disconnected from WebRTC session');
    }

    // Set callbacks for WebRTC events
    function setCallbacks(newCallbacks)
    {
        callbacks = { ...callbacks, ...newCallbacks };
        console.log('[WebRTC-Main] Callbacks updated');
    }

    // Get connection status
    function getStatus()
    {
        const connectedPeers = [];
        for (const [userId, peerConnection] of peerConnections)
        {
            if (peerConnection.connectionState === 'connected')
            {
                connectedPeers.push(userId);
            }
        }

        return {
            isInitialized,
            isConnected,
            localUserId,
            sessionId,
            connectedPeers: connectedPeers,
            totalPeers: peerConnections.size
        };
    }

    // Debug function
    function getDebugInfo()
    {
        const status = getStatus();
        const peerStates = {};

        for (const [userId, peerConnection] of peerConnections)
        {
            peerStates[userId] = {
                connectionState: peerConnection.connectionState,
                iceConnectionState: peerConnection.iceConnectionState,
                signalingState: peerConnection.signalingState
            };
        }

        return {
            ...status,
            peerStates,
            dataChannels: Array.from(dataChannels.keys())
        };
    }

    // Public API
    return {
        // Initialization
        initializeWithSignalR,
        connectToSession,
        disconnect,

        // Event handling (called from Blazor)
        handlePeerJoined,
        handlePeerLeft,
        handleSignalingMessage,
        handleIncomingDataMessage: handleIncomingDataMessage,


        // Communication
        sendDataChannelMessage,
        broadcastMessage,

        // Configuration
        setCallbacks,

        // Status
        getStatus,
        getDebugInfo,

        // Properties
        get isInitialized() { return isInitialized; },
        get isConnected() { return isConnected; },
        get localUserId() { return localUserId; },
        get sessionId() { return sessionId; }
    };
})();

// Make it globally available
window.WebRTC_P2P = WebRTC_P2P;

console.log('[WebRTC-Main] WebRTC system initialized');
