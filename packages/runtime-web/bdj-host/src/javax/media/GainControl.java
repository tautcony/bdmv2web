package javax.media;

public interface GainControl extends Control {
    public default float getDB() { return 0.0f; }
    public default float setDB(float level) { return level; }
    public default float getLevel() { return 1.0f; }
    public default float setLevel(float level) { return level; }
    public default boolean getMute() { return false; }
    public default void setMute(boolean muted) { }
}
