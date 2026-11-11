import javax.tv.xlet.Xlet;
import javax.tv.xlet.XletContext;
import javax.tv.xlet.XletStateChangeException;
import com.bdmv2web.bdj.LifecycleState;
import org.dvb.application.AppID;
import org.dvb.application.AppProxy;
import org.dvb.application.AppsDatabase;

public final class TitleBoundLifecycleXlet implements Xlet {
    private static int classBootCount;

    public void initXlet(XletContext context) {
        LifecycleState.titleInitialized++;
        LifecycleState.titleClassBootCounts.add(++classBootCount);
        AppProxy menu = AppsDatabase.getAppsDatabase().getAppProxy(new AppID(0x7fff0001, 0x1001));
        if (menu != null && menu.getState() == AppProxy.NOT_LOADED) LifecycleState.presentWasUnstartedAtTitleInit++;
    }
    public void startXlet() throws XletStateChangeException {
        LifecycleState.titleStarted++;
        AppProxy menu = AppsDatabase.getAppsDatabase().getAppProxy(new AppID(0x7fff0001, 0x1001));
        if (menu != null) { LifecycleState.presentStartRequested++; menu.start(); }
    }
    public void pauseXlet() { }
    public void destroyXlet(boolean unconditional) throws XletStateChangeException { LifecycleState.titleDestroyed++; }
}
