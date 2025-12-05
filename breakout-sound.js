// TripGeo.Client/wwwroot/geobox-assets/games/tankofduty/tankofduty-sound.js
// Sound management for Tank of Duty

export class TankSoundManager
{
    constructor()
    {
        this.sounds = new Map();
        this.enabled = true;
        this.volume = 0.5; // Default volume (0.0 to 1.0)

        // Check if user has muted sounds in localStorage
        const savedVolume = localStorage.getItem('tankofduty-volume');
        if (savedVolume !== null)
        {
            this.volume = parseFloat(savedVolume);
            this.enabled = this.volume > 0;
        }
    }

    loadSound(name, path)
    {
        // Create audio element
        const audio = new Audio(`/sounds/tankofduty/${path}`);
        audio.volume = this.volume;
        audio.preload = 'auto';

        // Store in map
        this.sounds.set(name, audio);

        console.log(`[TankSound] Loaded sound: ${name}`);
    }

    initSounds()
    {
        console.log('[TankSound] Initializing sounds...');

        this.loadSound('explode1', 'Sci Fi Explosion 03.mp3');
        this.loadSound('explode2', 'Sci Fi Explosion 06.mp3');
        this.loadSound('fire1', 'Weapon 01 Shoot 1.mp3');
        this.loadSound('fire2', 'Weapon 13 Shoot 1.mp3');
        this.loadSound('reload', 'Weapon 13 Reload 1.mp3');

        console.log('[TankSound] All sounds loaded');
    }

    playSound(name, volumeMultiplier = 1.0)
    {
        if (!this.enabled) return;

        const sound = this.sounds.get(name);
        if (!sound)
        {
            console.warn(`[TankSound] Sound not found: ${name}`);
            return;
        }

        try
        {
            // Clone the audio element to allow overlapping sounds
            const soundInstance = sound.cloneNode();
            soundInstance.volume = this.volume * volumeMultiplier;

            // Play and clean up
            soundInstance.play().catch(err => 
            {
                // Ignore errors (e.g., user hasn't interacted with page yet)
                if (err.name !== 'NotAllowedError')
                {
                    console.warn(`[TankSound] Error playing ${name}:`, err);
                }
            });

            // Clean up after playing
            soundInstance.addEventListener('ended', () => 
            {
                soundInstance.remove();
            });
        }
        catch (err)
        {
            console.warn(`[TankSound] Error playing sound ${name}:`, err);
        }
    }

    setVolume(volume)
    {
        this.volume = Math.max(0, Math.min(1, volume));
        this.enabled = this.volume > 0;

        // Update all loaded sounds
        this.sounds.forEach(sound => 
        {
            sound.volume = this.volume;
        });

        // Save to localStorage
        localStorage.setItem('tankofduty-volume', this.volume.toString());

        console.log(`[TankSound] Volume set to ${this.volume}`);
    }

    toggleMute()
    {
        if (this.enabled)
        {
            this.previousVolume = this.volume;
            this.setVolume(0);
        }
        else
        {
            this.setVolume(this.previousVolume || 0.5);
        }

        return this.enabled;
    }

    // Play specific game sounds
    playOwnExplosion()
    {
        this.playSound('explode1', 1.0);
    }

    playOpponentExplosion()
    {
        this.playSound('explode2', 0.8); // Slightly quieter for opponent
    }

    playOwnFire()
    {
        this.playSound('fire1', 0.7);
    }

    playOpponentFire()
    {
        this.playSound('fire2', 0.5); // Quieter for opponent
    }

    playReload()
    {
        this.playSound('reload', 0.6);
    }

    dispose()
    {
        this.sounds.forEach(sound => 
        {
            sound.pause();
            sound.remove();
        });
        this.sounds.clear();

        console.log('[TankSound] Sounds disposed');
    }
}
