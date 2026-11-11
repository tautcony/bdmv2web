package org.bluray.media;

public interface AudioControl extends javax.media.Control {
    public default int getCurrentStreamNumber() { return 1; }
    public default int[] listAvailableStreamNumbers() { return new int[] { 1 }; }
    public default void selectStreamNumber(int a0) { }
}
