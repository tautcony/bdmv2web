package org.havi.ui;

public class HVideoDevice extends HScreenDevice {
    private HVideoConfiguration current = new HVideoConfiguration(new HVideoConfigTemplate());
    public HVideoDevice() { }
    public org.havi.ui.HVideoConfiguration getBestConfiguration(org.havi.ui.HVideoConfigTemplate template) { return new HVideoConfiguration(template); }
    public boolean setVideoConfiguration(org.havi.ui.HVideoConfiguration configuration) { if (configuration == null) return false; current = configuration; return true; }
    public org.havi.ui.HVideoConfiguration getCurrentConfiguration() { return current; }
}
