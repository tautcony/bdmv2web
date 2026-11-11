package org.bluray.media;

public interface SubtitlingControl extends org.dvb.media.SubtitlingEventControl, javax.media.Control {
    public default int getCurrentStreamNumber() { return 0; }
    public default int[] listAvailableStreamNumbers() { return null; }
    public default void selectStreamNumber(int a0) {  }
}
