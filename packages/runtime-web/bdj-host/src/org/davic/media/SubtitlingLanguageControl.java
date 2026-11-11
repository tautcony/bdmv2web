package org.davic.media;

public interface SubtitlingLanguageControl {
    public default boolean isSubtitlingOn() { return false; }
    public default boolean setSubtitling(boolean a0) { return false; }
}
