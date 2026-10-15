package com.lockowom.inven3;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setAppearanceLightNavigationBars(false);

        if (Build.VERSION.SDK_INT >= 35) {
            View webView = getBridge().getWebView();
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                ViewGroup.LayoutParams rawParams = view.getLayoutParams();
                if (rawParams instanceof ViewGroup.MarginLayoutParams) {
                    ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) rawParams;
                    if (
                        params.leftMargin != bars.left
                        || params.topMargin != bars.top
                        || params.rightMargin != bars.right
                        || params.bottomMargin != bars.bottom
                    ) {
                        params.setMargins(bars.left, bars.top, bars.right, bars.bottom);
                        view.setLayoutParams(params);
                    }
                }
                return windowInsets;
            });
            ViewCompat.requestApplyInsets(webView);
        }
    }
}
