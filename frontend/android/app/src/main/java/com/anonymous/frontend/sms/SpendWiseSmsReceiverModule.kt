package com.anonymous.frontend.sms

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.telephony.SmsMessage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class SpendWiseSmsReceiverModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  private var receiverRegistered = false

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != "android.provider.Telephony.SMS_RECEIVED") {
        return
      }

      val bundle = intent.extras ?: return
      val pdus = bundle.get("pdus") as? Array<*> ?: return
      val format = bundle.getString("format")

      for (pdu in pdus) {
        val message = try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            SmsMessage.createFromPdu(pdu as ByteArray, format)
          } else {
            @Suppress("DEPRECATION")
            SmsMessage.createFromPdu(pdu as ByteArray)
          }
        } catch (_: Exception) {
          null
        } ?: continue

        val payload = Arguments.createMap().apply {
          putString("body", message.messageBody ?: "")
          putString("address", message.originatingAddress ?: "")
          putDouble("timestamp", message.timestampMillis.toDouble())
        }

        reactApplicationContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("SpendWiseSmsReceived", payload)
      }
    }
  }

  override fun getName(): String = "SpendWiseSmsReceiver"

  init {
    reactContext.addLifecycleEventListener(this)
  }

  @ReactMethod
  fun start() {
    registerReceiverIfNeeded()
  }

  @ReactMethod
  fun stop() {
    unregisterReceiverIfNeeded()
  }

  @SuppressLint("UnspecifiedRegisterReceiverFlag")
  private fun registerReceiverIfNeeded() {
    if (receiverRegistered) return

    val filter = IntentFilter("android.provider.Telephony.SMS_RECEIVED")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactApplicationContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      reactApplicationContext.registerReceiver(receiver, filter)
    }
    receiverRegistered = true
  }

  private fun unregisterReceiverIfNeeded() {
    if (!receiverRegistered) return
    try {
      reactApplicationContext.unregisterReceiver(receiver)
    } catch (_: Exception) {
      // no-op
    } finally {
      receiverRegistered = false
    }
  }

  override fun onHostResume() {}

  override fun onHostPause() {}

  override fun onHostDestroy() {
    unregisterReceiverIfNeeded()
  }
}
