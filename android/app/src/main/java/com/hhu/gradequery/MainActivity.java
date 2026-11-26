package com.hhu.gradequery;

import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 注册 cookie 读写与落盘桥接（bridge 在 super.onCreate() 后已初始化）
        // JS 层无法通过 document.cookie 读写跨源/HttpOnly cookie（如 WebVPN ticket、CASTGC、smst），
        // 需要 native 层直接调用 Android CookieManager，并在写入后 flush 落盘，确保清后台重开免登。
        bridge.getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String getCookiesForUrl(String url) {
                return CookieManager.getInstance().getCookie(url);
            }

            @JavascriptInterface
            public void setCookie(String url, String cookie) {
                CookieManager.getInstance().setCookie(url, cookie);
            }

            @JavascriptInterface
            public void flushCookies() {
                CookieManager.getInstance().flush();
            }
        }, "HHUCookieHelper");
    }
}
