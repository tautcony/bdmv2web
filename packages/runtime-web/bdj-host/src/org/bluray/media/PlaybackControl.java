package org.bluray.media;

public interface PlaybackControl extends javax.media.Control {
    public void addPlaybackControlListener(org.bluray.media.PlaybackListener listener);
    public void removePlaybackControlListener(org.bluray.media.PlaybackListener listener);
    public default void skipToMark(int a0) {  }
    public default boolean skipToNextMark(int a0) { return false; }
    public default void skipToPlayItem(int a0) {  }
    public default boolean skipToPreviousMark(int a0) { return false; }
}
