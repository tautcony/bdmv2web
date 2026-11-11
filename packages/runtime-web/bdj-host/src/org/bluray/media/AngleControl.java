package org.bluray.media;

public interface AngleControl extends javax.media.Control {
    public default void addAngleChangeListener(org.bluray.media.AngleChangeListener a0) {  }
    public default int getAvailableAngles() { return 0; }
    public default int getCurrentAngle() { return 0; }
    public default void removeAngleChangeListener(org.bluray.media.AngleChangeListener a0) {  }
    public default void selectAngle(int a0) {  }
}
