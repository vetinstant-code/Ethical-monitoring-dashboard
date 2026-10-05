/*
 * ESP32Task.h
 *
 *  Created on: Jun 3, 2025
 *      Author: codeh
 */

#ifndef INC_ESP32TASK_H_
#define INC_ESP32TASK_H_



#include <stdint.h>
#include <string.h> // For memcpy

// --- Packet Constants ---
#define START_BYTE 0xAA
#define END_BYTE   0x55
#define MAX_PAYLOAD_SIZE 240 // Adjust as needed. Max PACKET_LENGTH is 255.
                            // PACKET_LENGTH = 1 (CMD) + payload_len + 1 (CHK)
                            // So, payload_len = PACKET_LENGTH - 2.
                            // MAX_PAYLOAD_SIZE should be <= (255 - 2) = 253.
                            // 64 is a reasonable starting point.

// --- Command IDs ---
#define CMD_WIFI_STATUS_REQ  0x01
#define CMD_WIFI_STATUS_RESP 0x02
#define CMD_QR_REQ      0x03
#define CMD_QR_RESP     0x04
#define CMD_RSSI_REQ      0x10
#define CMD_RSSI_RESP     0x11
/* CMD_RSSI_RESP (ESP → STM): PACKET_LENGTH = 0x0C (12) = 1 CMD + 10 payload + 1 checksum.
 * Payload after CMD byte:
 *   [0] rssi_category uint8 (1…5)
 *   [1] mqtt_connected uint8 (0/1)
 *   [2..5] audio_upload_kbps uint32 LE (decimal kb/s)
 *   [6] mqtt_queue_fill_pct uint8 (0–100)
 *   [7] ring_fill_pct uint8 (0–100)
 *   [8..9] publish_jitter_mad_ms uint16 LE (ms, MAD of inter-publish gaps, max 65535)
 * Legacy ESP may send 6-byte payload; STM still decodes kbps when plen >= 6. */
#define CMD_RSSI_RESP_PAYLOAD_LEN 10u
#define CMD_RECONNECT     0x2D
#define CMD_WIFI_SIGNOUT  0x3A
#define CMD_AUDIO_CONTROL 0x40
#define CMD_AUDIO_CONTROL_RESP 0x41

// --- Audio Type Codes (payload values, not command IDs) ---
#define CMD_AUDIO_TYPE_HEART_P   0x00
#define CMD_AUDIO_TYPE_HEART_A   0x01
#define CMD_AUDIO_TYPE_HEART_M   0x02
#define CMD_AUDIO_TYPE_HEART_T   0x03
#define CMD_AUDIO_TYPE_LUNG_LL1  0x04
#define CMD_AUDIO_TYPE_LUNG_LL2  0x05
#define CMD_AUDIO_TYPE_LUNG_RL1  0x06
#define CMD_AUDIO_TYPE_LUNG_RL2  0x07
#define CMD_AUDIO_TYPE_RAW       0x08

#define AUDIO_STREAM_STATE_STOP  0x00
#define AUDIO_STREAM_STATE_START 0x01
#define AUDIO_CONTROL_STATUS_ERROR   0x00
#define AUDIO_CONTROL_STATUS_SUCCESS 0x01

// --- User Identity Commands ---
#define CMD_USER_ID_REQUEST      0x4C
#define CMD_USER_ID_RESPONSE     0x4D
#define CMD_USER_ID_ACK          0x4E
#define CMD_USER_ID_NOT_AVAILABLE 0x4F

#define USER_ID_STATUS_SUCCESS   0x00
#define USER_ID_STATUS_NOT_AVAILABLE 0x02
#define USER_ID_ACK_OK           0x01

#define USER_ID_MAX_LEN          32
#define USER_EMAIL_MAX_LEN       64

// --- User Identity State Structure ---
// This struct holds the current user identity information received from ESP32
#ifdef __cplusplus
extern "C" {
#endif

#include <stdbool.h>

typedef struct {
    uint8_t status;
    uint8_t userIdLen;
    uint8_t emailLen;
    char userId[USER_ID_MAX_LEN + 1];
    char email[USER_EMAIL_MAX_LEN + 1];
    bool responseValid;
} UserIdentityState_t;

extern UserIdentityState_t userIdentityState;
extern volatile uint8_t wifiSignoutPending;
extern volatile uint8_t wifiSignoutTxCounter;
extern volatile uint8_t signoutFlowActive;
extern volatile uint8_t qrScreenNavPending;
extern volatile uint8_t userIdReceived;
extern volatile uint8_t qrRequestPending;
extern volatile uint8_t qrRequestInProgress;
extern volatile uint8_t userIdPollActive;
extern volatile uint8_t userIdPollAwaitingWifi;
extern volatile uint8_t userIdPollForceSend;
extern volatile uint8_t userIdPollSeenWifiDrop;
extern volatile uint32_t userIdPollTxCounter;

#ifdef __cplusplus
}
#endif

// --- Wi-Fi Status Codes (for CMD_WIFI_STATUS_RESP payload) ---
#define WIFI_STATUS_NOT_CONNECTED 0x00
#define WIFI_STATUS_CONNECTED     0x01
#define WIFI_STATUS_CONNECTING    0x13
#define WIFI_STATUS_ERROR         0x03

#define CMD_PROFILE_REQ 0x05
#define CMD_PROFILE_RESP 0x06
#define CMD_PET_LIST_REQ 0x07
#define CMD_PET_LIST_RESP 0x08
#define CMD_PET_SEL 0x09
#define CMD_EXAMD_ID_RESP 0x0A
#define CMD_TEMP_DATA 0x0B
#define CMD_SPO2_DATA 0x0C
#define CMD_SENSOR_ACK 0x0D
#define CMD_TEMP_CLOUD_ACK 0x55
#define CMD_CLOUD_PROBE_REQ  0x56  /* STM → ESP: MQTT uplink capacity probe */
#define CMD_CLOUD_PROBE_RESP 0x57  /* ESP → STM: probe result */
#define CMD_CLOUD_WARN       0x58  /* ESP → STM: unsolicited cloud quality warn */
#define CMD_STM_DIAGNOSTIC     0x59  /* STM → ESP: compact diagnostic event */
#define CMD_STM_DIAGNOSTIC_ACK 0x5A  /* ESP → STM: diagnostic delivery ACK */
#define CMD_STM_STATUS         0x5B  /* STM → ESP: health snapshot / UI event (integers) */
#define CMD_Manual_ID_Check 0x30
#define RESP_Manual_ID_Check 0x31

/* CMD_CLOUD_PROBE_RESP result codes (payload[0]) */
#define CLOUD_PROBE_CANT     0x00
#define CLOUD_PROBE_UNSTABLE 0x01
#define CLOUD_PROBE_GOOD     0x02

/* CMD_CLOUD_WARN quality (payload[0]) */
#define CLOUD_WARN_DOWN      0
#define CLOUD_WARN_UNSTABLE  1
#define CLOUD_WARN_OK        2

// --- OTA command protocol (ESP32 <-> STM32) ---
#define CMD_OTA_AVAILABLE      0x50   /* ESP -> STM: STM32 update available (version + job_id) */
#define CMD_STM_START_OTA      0x51   /* STM -> ESP: start pending STM32 OTA */
#define CMD_ESP_OTA            0x52   /* ESP -> STM: ESP OTA phase 0x00=available, 0x01=starting */
#define CMD_ESP_OTA_SUCCESS    0x53   /* ESP -> STM: ESP OTA finished (after reboot) */
#define CMD_STM_START_ESP_OTA  0x54   /* STM -> ESP: start pending ESP OTA (use after 0x52 phase 0x00) */
#define ESP_OTA_PHASE_AVAILABLE 0x00
#define ESP_OTA_PHASE_STARTING   0x01
#define OTA_VERSION_MAX_LEN 64
#define OTA_JOB_ID_MAX_LEN  128

#ifdef __cplusplus
extern "C" {
#endif
extern char ota_version_string[OTA_VERSION_MAX_LEN + 1];
extern char ota_job_id_string[OTA_JOB_ID_MAX_LEN + 1];
extern volatile uint8_t ota_available_flag;  /* 1 when CMD_OTA_AVAILABLE or CMD_ESP_OTA phase 0x00 received */
extern volatile uint8_t ota_notif_pending;   /* 1 = show OTA notif when user is on home (or when they enter home) */
extern volatile uint8_t is_esp_ota;          /* 1 = current OTA is ESP OTA (0x52 phase 0x00), 0 = STM32 OTA (0x50) */
extern volatile uint8_t esp_ota_starting;    /* 1 when CMD_ESP_OTA phase 0x01 received */
extern volatile uint8_t esp_ota_success;     /* 1 when CMD_ESP_OTA_SUCCESS (0x53) received */
extern volatile uint8_t tempCloudAckPending; /* 1 when fresh CMD_TEMP_CLOUD_ACK received and not yet consumed by UI */
extern volatile uint8_t tempCloudAckStatus;  /* 1=uploaded, 0=failed, 0xFF=unknown */
extern volatile uint8_t tempCloudAckMessageIdLen;
extern char tempCloudAckMessageId[64];
extern volatile uint8_t cloudProbeRespPending;
extern volatile uint8_t cloudProbeResult;       /* 0=CANT, 1=UNSTABLE, 2=GOOD */
extern volatile uint8_t cloudProbePktPerSec;
extern volatile uint16_t cloudProbeMaxBlockMs;
extern volatile uint16_t cloudProbeDurationMs;
extern volatile uint8_t cloudProbeMqttConnected;
extern volatile uint8_t cloudWarnPending;
extern volatile uint8_t cloudWarnQuality;       /* 0=DOWN, 1=UNSTABLE, 2=OK */
extern volatile uint8_t cloudWarnContext;       /* 0=idle, 1=streaming, 2=probe */
extern volatile uint8_t cloudWarnPktPerSec;
extern volatile uint8_t cloudWarnQueuePct;
extern volatile uint32_t audio_upload_kbps; /* CMD_RSSI_RESP: LE kb/s in payload[2..5] */
extern volatile uint8_t rssi_mqtt_queue_fill_pct; /* payload[6] */
extern volatile uint8_t rssi_ring_fill_pct;       /* payload[7] */
extern volatile uint16_t rssi_publish_jitter_mad_ms; /* payload[8..9] LE */
extern volatile uint8_t startaudiotoesp; /* 1: ESP CMD_AUDIO_CONTROL_RESP success + stream START (Esp32Task writes) */
#ifdef __cplusplus
}
#endif

// --- Parsed Packet Structure Definition ---
// This struct holds the data of a successfully received and validated packet.
typedef struct {
    uint8_t command_id;
    uint8_t payload[MAX_PAYLOAD_SIZE];
    uint8_t payload_len; // Actual length of data in payload array
} ParsedPacket_t;


// --- Utility Function: Calculate Checksum ---
// Calculates the 8-bit XOR checksum of a given data buffer.
// The checksum is calculated over the command_id and the entire payload.
uint8_t calculate_checksum(uint8_t command_id, const uint8_t *payload, uint8_t payload_len);

// --- Function Declarations ---
#ifdef __cplusplus
extern "C" {
#endif
void UART_Transmit_Packet(uint8_t command_id, const uint8_t *payload, uint8_t payload_len);
void UART_Send_Audio_Type_Command(uint8_t audio_type_command);
/** Send CMD_CLOUD_PROBE_REQ (0x56). duration_sec 2–8 (default 4 if out of range / 0). */
void UART_Send_Cloud_Probe_Request(uint8_t duration_sec);
void ESP32_RequestUserId(void);
void UART_Send_OTA_Start_Command(void);
/** Send CMD_STM_START_ESP_OTA (0x54) to ESP to start pending ESP OTA (use after 0x52 phase 0x00). */
void UART_Send_ESP_OTA_Start_Command(void);
/** Clear esp_ota_success flag (call after handling CMD_ESP_OTA_SUCCESS and transitioning UI). */
void clear_esp_ota_success(void);
/** Return current STM firmware version string (from main.c). Change in main.c with every release. */
const char* get_firmware_version(void);
#ifdef __cplusplus
}
#endif





#endif /* INC_ESP32TASK_H_ */
