class SoundHandler {
    constructor(soundIds) {
        this.soundMap = new Map();
        this.isPaused = true;
        this.lastPlayed = soundIds[0];
        for (const soundId of soundIds) {
            this.soundMap.set(
                soundId,
                document.getElementById(soundId)
            )
        }
    }

    setSound(soundId) {
        this.lastPlayed = soundId;
        if (!this.isPaused) {
            this.play(soundId);
        }
    }

    play(soundId) {
        if (soundId == undefined) {
            // Play nothing
            this.pause();
            return;
        }
        const sound = this.soundMap.get(soundId);
        if (!sound) {
            console.warn(`Sound ${soundId} not initialised!`);
            return;
        }
        // Pause all
        this.pause();

        // Play the correct one
        sound.play();
        this.lastPlayed = soundId;
        this.isPaused = false;
    }

    pause() {
        this.soundMap.values().forEach(s=>s.pause());
        this.isPaused = true;
    }

    resume() {
        if (this.lastPlayed !== undefined) {
            this.play(this.lastPlayed);
        }
        this.isPaused = false;
    }
}

export {SoundHandler}