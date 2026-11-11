package org.havi.ui;

public class HScreen {
    private static final HScreen INSTANCE = new HScreen();
    private final HVideoDevice video = new HVideoDevice();
    private final HBackgroundDevice background = new HBackgroundDevice();
    private final HGraphicsDevice graphics = new HGraphicsDevice();
    public HScreen() { }
    public static org.havi.ui.HScreen getDefaultHScreen() { return INSTANCE; }
    public org.havi.ui.HVideoDevice getDefaultHVideoDevice() { return video; }
    public org.havi.ui.HBackgroundDevice getDefaultHBackgroundDevice() { return background; }
    public org.havi.ui.HGraphicsDevice getDefaultHGraphicsDevice() { return graphics; }
}
