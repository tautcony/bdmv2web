package javax.tv.service.selection;

import javax.tv.service.Service;

public interface ServiceContext {
    Service getService();
    void select(Service service);
    void stop();
}
