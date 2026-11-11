package javax.tv.service;

import org.bluray.net.BDLocator;
import org.bluray.ti.Title;

public final class SIManager {
    private static final SIManager INSTANCE = new SIManager();
    private SIManager() { }
    public static javax.tv.service.SIManager createInstance() { return INSTANCE; }
    public javax.tv.service.Service getService(javax.tv.locator.Locator locator) {
        if (!(locator instanceof BDLocator)) return null;
        final int titleNumber = ((BDLocator) locator).getTitleNumber();
        return titleNumber < 0 ? null : new Title() { public int getTitleNumber() { return titleNumber; } };
    }
}
