package com.hhu.gradequery;

import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 注册 cookie 读取接口（bridge 在 super.onCreate() 后已初始化）
        // JS 层无法通过 document.cookie 读取 WebVPN 域的 cookie，
        // 需要 native 层直接调用 webkitCookieManager.getCookie(url)
        bridge.getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String getCookiesForUrl(String url) {
                return android.webkit.CookieManager.getInstance().getCookie(url);
            }
        }, "HHUCookieHelper");
    }
}
