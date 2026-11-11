package org.dvb.application;

public interface AppProxy {
    int STARTED = 0;
    int DESTROYED = 1;
    int NOT_LOADED = 2;
    int PAUSED = 3;
    public default int getState() { return 0; }
    public default void start() {  }
    public default void pause() {  }
    public default void resume() {  }
}
