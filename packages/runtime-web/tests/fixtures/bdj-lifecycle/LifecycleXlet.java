import javax.tv.xlet.Xlet;
import javax.tv.xlet.XletContext;
import javax.tv.xlet.XletStateChangeException;
import com.bdmv2web.bdj.LifecycleState;

public final class LifecycleXlet implements Xlet {
    private static int classBootCount;

    public void initXlet(XletContext value) {
        LifecycleState.discInitialized++;
        LifecycleState.discContext = value;
        LifecycleState.discClassBootCount = ++classBootCount;
        Object parameters = value.getXletProperty("dvb.app.parameters");
        if (!(parameters instanceof String[]) || ((String[]) parameters).length != 1 || !"menu".equals(((String[]) parameters)[0])) {
            throw new IllegalStateException("Application parameters were not exposed.");
        }
    }

    public void startXlet() throws XletStateChangeException { LifecycleState.discStarted++; }
    public void pauseXlet() { LifecycleState.discPaused++; }
    public void destroyXlet(boolean unconditional) throws XletStateChangeException { LifecycleState.discDestroyed++; }
}
