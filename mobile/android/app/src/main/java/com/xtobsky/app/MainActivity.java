package com.xtobsky.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(MobileBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
