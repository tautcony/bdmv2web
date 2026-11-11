package org.havi.ui;

public final class HSceneFactory {
    private static final HSceneFactory INSTANCE = new HSceneFactory();
    private HSceneFactory() { }
    public static HSceneFactory getInstance() { return INSTANCE; }
    public HScene getBestScene(HSceneTemplate template) { return new HScene(); }
}
