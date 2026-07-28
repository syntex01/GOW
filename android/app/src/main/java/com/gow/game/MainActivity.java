package com.gow.game;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * The game, in a window with nothing else in it.
 *
 * Three things a phone does by default that a battlefield cannot live with: it
 * puts a status bar and a navigation bar over the board, it dims and sleeps the
 * screen through the long quiet stretches of a siege, and it lets the system
 * bars swipe back in over the bottom of the screen — which is exactly where
 * every button in the game is.
 */
public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // The canvas draws to the physical edges, including behind a notch.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      getWindow().getAttributes().layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }

    // A match can sit quiet for a minute while two economies build up. The
    // screen must not go out in the middle of it.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    hideSystemBars();
  }

  /**
   * Hardware back means "back", not "quit".
   *
   * The default closes the app outright, which on a phone means a stray thumb
   * throws away a match in progress. The game already knows what back means at
   * every point — close the research tree, close the outworks, open the pause
   * menu — and it reaches all of that through Escape, so back is delivered as
   * Escape and only falls through to leaving when the game says it is done.
   */
  @Override
  public void onBackPressed() {
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().evaluateJavascript(
        "(function(){"
          + "var e=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true});"
          + "window.dispatchEvent(e);document.dispatchEvent(e);return true})()",
        null
      );
      return;
    }
    super.onBackPressed();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    // Coming back from the recents switcher or a notification restores the
    // bars, so they are put away again every time focus returns.
    if (hasFocus) hideSystemBars();
  }

  private void hideSystemBars() {
    View decor = getWindow().getDecorView();
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decor);
    controller.hide(WindowInsetsCompat.Type.systemBars());
    // BY_SWIPE rather than BY_TOUCH: a tap on the command row would otherwise
    // bring the navigation bar back up over the buttons being tapped.
    controller.setSystemBarsBehavior(
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    );
  }
}
