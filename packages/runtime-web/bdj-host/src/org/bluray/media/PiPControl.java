package org.bluray.media;

public interface PiPControl extends javax.media.Control {
    public default int getCurrentStreamNumber() { return 0; }
    public default void selectStreamNumber(int a0) {  }
    public default void setDisplay(boolean a0) {  }
}
