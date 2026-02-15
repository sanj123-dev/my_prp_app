package com.anonymous.frontend.sms

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsMessage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import org.json.JSONArray
import androidx.core.content.ContextCompat
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

  @ReactMethod
  fun list(filterJson: String?, onFailure: Callback, onSuccess: Callback) {
    try {
      val granted = ContextCompat.checkSelfPermission(
        reactApplicationContext,
        android.Manifest.permission.READ_SMS,
      ) == PackageManager.PERMISSION_GRANTED

      if (!granted) {
        onFailure.invoke("READ_SMS permission not granted")
        return
      }

      val filter = if (!filterJson.isNullOrBlank()) JSONObject(filterJson) else JSONObject()
      val minDate = filter.optLong("minDate", 0L)
      val indexFrom = maxOf(0, filter.optInt("indexFrom", 0))
      val maxCount = maxOf(1, filter.optInt("maxCount", 100))
      val endExclusive = indexFrom + maxCount

      val projection = arrayOf(
        Telephony.Sms._ID,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE,
        Telephony.Sms.ADDRESS,
      )

      val selection = if (minDate > 0) "${Telephony.Sms.DATE} >= ?" else null
      val selectionArgs = if (minDate > 0) arrayOf(minDate.toString()) else null
      val sortOrder = "${Telephony.Sms.DATE} DESC"

      val list = JSONArray()
      var rowIndex = 0
      reactApplicationContext.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        projection,
        selection,
        selectionArgs,
        sortOrder,
      )?.use { cursor ->
        val idIdx = cursor.getColumnIndex(Telephony.Sms._ID)
        val bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY)
        val dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE)
        val addressIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS)

        while (cursor.moveToNext()) {
          if (rowIndex >= endExclusive) break
          if (rowIndex >= indexFrom) {
            val item = JSONObject()
            item.put("_id", if (idIdx >= 0) cursor.getString(idIdx) else "")
            item.put("id", if (idIdx >= 0) cursor.getString(idIdx) else "")
            item.put("body", if (bodyIdx >= 0) cursor.getString(bodyIdx) else "")
            item.put("date", if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L)
            item.put("address", if (addressIdx >= 0) cursor.getString(addressIdx) else "")
            list.put(item)
          }
          rowIndex += 1
        }
      }

      onSuccess.invoke(list.length(), list.toString())
    } catch (error: Exception) {
      onFailure.invoke(error.message ?: "Unable to read SMS inbox")
    }
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
