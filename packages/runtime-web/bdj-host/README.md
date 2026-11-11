# BD-J host classes

The Java host sources provide the Xlet entrypoint and host API layer bundled into BD-J packages. They target Java 8 bytecode. `bdmv2web build` compiles the host with `javac` and `jar`, then writes `runtime/bdj/bdj-host-api.jar` into the generated package. CLI release bundling also compiles the host for package generation.

`bdmv2web serve` runs the packaged host with a Java runtime that includes `java.desktop`.
