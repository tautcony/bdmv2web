package fixture.ixc;

import java.rmi.Remote;
import java.rmi.RemoteException;

public interface Echo extends Remote {
    int echo(int value) throws RemoteException;
    void fail() throws RemoteException;
}
