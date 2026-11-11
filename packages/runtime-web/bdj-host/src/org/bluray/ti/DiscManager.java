package org.bluray.ti;

public final class DiscManager {
    private static final DiscManager INSTANCE = new DiscManager();
    private static final Disc DISC = new Disc() { public String getId() { return com.bdmv2web.bdj.BdjHostBridge.call("discId"); } };
    private DiscManager() { }
    public static DiscManager getDiscManager() { return INSTANCE; }
    public Disc getCurrentDisc() { return DISC; }
    public void expectNextDisc(String[] ids) { throw new UnsupportedOperationException("Disc switching is unavailable in a browser package."); }
}
