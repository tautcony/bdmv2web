package fixture.ixc;

import java.rmi.RemoteException;

public final class EchoImpl implements Echo {
    private final int offset;
    public EchoImpl(int offset) { this.offset = offset; }
    public int echo(int value) { return value + offset; }
    public void fail() throws RemoteException { throw new RemoteException("fixture failure"); }
}
