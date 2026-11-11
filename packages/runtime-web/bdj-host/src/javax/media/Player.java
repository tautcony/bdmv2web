package javax.media;

import java.awt.Component;

public interface Player extends Controller, Duration {
    void start();
    Component getVisualComponent();
    Component getControlPanelComponent();
    GainControl getGainControl();
}
