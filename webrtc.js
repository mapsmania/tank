// webrtc.js - Helper functions and global setup for WebRTC
// Main WebRTC_P2P module is in webrtc-p2p-core.js

'use strict';

console.log('[WebRTC-Helper] WebRTC helper module loading...');

// Global helper functions that webrtc-p2p-core.js might need
function log(message, ...args)
{
    console.log(`[WebRTC-Helper] ${message}`, ...args);
}

function error(message, ...args)
{
    console.error(`[WebRTC-Helper] ${message}`, ...args);
}

// Make sendSignalingMessage available globally for webrtc-p2p-core.js
window.sendWebRTCSignalingMessage = async function (targetUserId, messageType, messageData)
{
    // This will be called by webrtc-p2p-core.js
    // The actual implementation is in webrtc-p2p-core.js sendSignalingMessage function
    if (window.WebRTC_P2P && window.WebRTC_P2P.sendSignalingMessage)
    {
        return await window.WebRTC_P2P.sendSignalingMessage(targetUserId, messageType, messageData);
    } else
    {
        console.error('[WebRTC-Helper] WebRTC_P2P.sendSignalingMessage not available');
        throw new Error('WebRTC_P2P not initialized');
    }
};

// Set up global reference for TeamHub service events (if needed)
window.teamHubServiceEvents = {};

// Legacy compatibility helpers
window.setDotNetReference = function (dotNetRef)
{
    if (window.WebRTC_P2P && window.WebRTC_P2P.setDotNetReference)
    {
        window.WebRTC_P2P.setDotNetReference(dotNetRef);
    }
    log('.NET reference forwarded to main WebRTC module');
};

window.getDotNetReference = function ()
{
    if (window.WebRTC_P2P && window.WebRTC_P2P.getDotNetReference)
    {
        return window.WebRTC_P2P.getDotNetReference();
    }
    return null;
};

console.log('[WebRTC-Helper] Helper module loaded');
