package javax.tv.service.selection;

public class ServiceContextFactory {
    private static final ServiceContextFactory INSTANCE = new ServiceContextFactory();
    private final ServiceContext context = new LocalTitleContext();
    public ServiceContextFactory() { }
    public static javax.tv.service.selection.ServiceContextFactory getInstance() { return INSTANCE; }
    public javax.tv.service.selection.ServiceContext getServiceContext(javax.tv.xlet.XletContext a0) { return context; }

    private static final class LocalTitleContext implements org.bluray.ti.selection.TitleContext {
        private volatile javax.tv.service.Service current;
        public javax.tv.service.Service getService() { return current; }
        public void stop() { current = null; }
        public void select(javax.tv.service.Service service) {
            if (!(service instanceof org.bluray.ti.Title)) throw new IllegalArgumentException("BD-J service selection requires a title.");
            start((org.bluray.ti.Title) service, true);
        }
        public void start(org.bluray.ti.Title title, boolean restart) {
            if (title == null) throw new IllegalArgumentException("A Blu-ray title is required.");
            int titleNumber = title.getTitleNumber();
            boolean effectiveRestart = restart || !(current instanceof org.bluray.ti.Title)
                || ((org.bluray.ti.Title) current).getTitleNumber() != titleNumber;
            com.bdmv2web.bdj.BdjHostBridge.call("selectTitle", Integer.toString(titleNumber), Boolean.toString(effectiveRestart));
            current = title;
        }
    }
}
