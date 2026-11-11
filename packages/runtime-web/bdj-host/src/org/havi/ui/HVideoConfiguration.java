package org.havi.ui;

public class HVideoConfiguration {
    private final HVideoConfigTemplate template;
    public HVideoConfiguration() { this(new HVideoConfigTemplate()); }
    public HVideoConfiguration(HVideoConfigTemplate template) { this.template = template; }
    public org.havi.ui.HVideoConfigTemplate getConfigTemplate() { return template; }
}
