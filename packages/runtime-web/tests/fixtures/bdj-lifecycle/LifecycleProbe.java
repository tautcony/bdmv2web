import com.bdmv2web.bdj.BdjApplicationManager;
import com.bdmv2web.bdj.LifecycleState;
import com.bdmv2web.bdj.BdjHostBridge;
import org.bluray.ti.Title;
import org.bluray.ti.selection.TitleContext;
import javax.tv.service.selection.ServiceContextFactory;
import org.dvb.application.AppID;
import org.dvb.application.AppProxy;
import org.dvb.application.AppsDatabase;

public final class LifecycleProbe {
    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    private static void await(java.util.function.BooleanSupplier condition, String message) throws Exception {
        long deadline = System.currentTimeMillis() + 3000L;
        while (!condition.getAsBoolean() && System.currentTimeMillis() < deadline) Thread.sleep(10L);
        require(condition.getAsBoolean(), message);
    }

    private static Title title(final int number) {
        return new Title() { public int getTitleNumber() { return number; } };
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Expected the synthetic disc root.");
        System.setProperty("bluray.vfs.root", args[0]);
        BdjApplicationManager manager = new BdjApplicationManager();
        manager.add(new BdjApplicationManager.Application("00001", 2, 1, 0x7fff0001, 0x1001,
            "LifecycleXlet", "00000", "", new String[] { "menu" }));
        manager.add(new BdjApplicationManager.Application("00000", 2, 1, 0x7fff0001, 0x1001,
            "LifecycleXlet", "00000", "", new String[] { "menu" }));
        manager.add(new BdjApplicationManager.Application("00001", 1, 3, 0x7fff0001, 0x1002,
            "TitleBoundLifecycleXlet", "00000", "", new String[0]));
        manager.add(new BdjApplicationManager.Application("00000", 1, 3, 0x7fff0001, 0x1002,
            "TitleBoundLifecycleXlet", "00000", "", new String[0]));

        manager.activate("00001", 0xffff);
        AppID id = new AppID(0x7fff0001, 0x1001);
        AppID titleId = new AppID(0x7fff0001, 0x1002);
        AppProxy proxy = AppsDatabase.getAppsDatabase().getAppProxy(id);
        AppProxy titleProxy = AppsDatabase.getAppsDatabase().getAppProxy(titleId);
        require(proxy != null, "Started application was not registered.");
        require(proxy.getState() == AppProxy.STARTED && LifecycleState.discInitialized == 1 && LifecycleState.discStarted == 1
                && LifecycleState.presentWasUnstartedAtTitleInit == 1 && LifecycleState.presentStartRequested == 1,
            "PRESENT did not initialize before AUTOSTART explicitly started it.");
        require("00001".equals(LifecycleState.discContext.getXletProperty("bluray.bdjo.id")), "Application context did not expose its active BDJO.");

        proxy.pause();
        require(proxy.getState() == AppProxy.PAUSED && LifecycleState.discPaused == 1, "pause() did not update the application state.");
        proxy.resume();
        require(proxy.getState() == AppProxy.STARTED && LifecycleState.discStarted == 2, "resume() did not restart the application.");

        manager.activate("00001", 1);
        require(LifecycleState.titleInitialized == 1 && LifecycleState.titleDestroyed == 0 && titleProxy.getState() == AppProxy.STARTED,
            "A title selection without restart replaced the title-bound application.");
        BdjHostBridge.setTitleSink(manager::dispatchTitle);
        TitleContext titleContext = (TitleContext) ServiceContextFactory.getInstance().getServiceContext(null);
        titleContext.start(title(2), false);
        await(() -> LifecycleState.titleInitialized == 2 && LifecycleState.titleDestroyed == 1, "A different title did not restart its title-bound application.");
        require(LifecycleState.titleStarted == 2 && LifecycleState.discInitialized == 1 && titleProxy.getState() == AppProxy.STARTED,
            "A title change did not retain the disc-bound menu and start the title-bound application.");
        titleContext.start(title(3), false);
        await(() -> LifecycleState.titleInitialized == 3 && LifecycleState.titleDestroyed == 2, "A second different title did not restart its title-bound application.");
        titleContext.start(title(3), false);
        Thread.sleep(50L);
        require(LifecycleState.titleInitialized == 3 && LifecycleState.titleDestroyed == 2,
            "Starting the same title without restart replaced the title-bound application.");
        titleContext.select(title(3));
        await(() -> LifecycleState.titleInitialized == 4 && LifecycleState.titleDestroyed == 3, "Selecting a service did not force a title-bound restart.");
        require(LifecycleState.titleStarted == 4 && LifecycleState.discInitialized == 1 && LifecycleState.discDestroyed == 0
                && LifecycleState.presentStartRequested == 4,
            "TitleContext lifecycle changed the retained disc-bound menu instance.");
        manager.activate("00000", 4, true);
        require(LifecycleState.titleInitialized == 5 && LifecycleState.titleDestroyed == 4
                && LifecycleState.discInitialized == 1 && LifecycleState.discDestroyed == 0
                && LifecycleState.presentStartRequested == 5,
            "BDJO activation restart did not replace the title-bound application while retaining the disc-bound menu.");
        manager.activate("00000", 0xffff);
        require(LifecycleState.discInitialized == 1 && LifecycleState.discDestroyed == 0 && LifecycleState.discClassBootCount == 1 && proxy.getState() == AppProxy.STARTED,
            "Disc-bound application did not retain identity across BDJO change.");
        require("00000".equals(LifecycleState.discContext.getXletProperty("bluray.bdjo.id")), "Application context did not follow the active BDJO.");
        manager.activate("00001", 0xffff);
        require(LifecycleState.discInitialized == 1 && LifecycleState.discDestroyed == 0 && LifecycleState.discClassBootCount == 1, "Returning to a compatible BDJO replaced the live application.");
        require(LifecycleState.titleInitialized == 5 && LifecycleState.titleDestroyed == 4,
            "Compatible application identity did not persist across BDJO transitions.");
        require(LifecycleState.titleClassBootCounts.equals(java.util.Arrays.asList(1, 1, 1, 1, 1)), "Title-bound class statics were not reset by each restart: " + LifecycleState.titleClassBootCounts);

        manager.shutdown();
        require(LifecycleState.discDestroyed == 1 && LifecycleState.titleDestroyed == 5 && AppsDatabase.getAppsDatabase().getAppProxy(id) == null,
            "Shutdown did not destroy and unregister applications.");
        System.err.println("LIFECYCLE_OK disc-bound-init=1 title-bound-init=5 title-bound-destroy=5 pause=1");
        System.exit(0);
    }
}
