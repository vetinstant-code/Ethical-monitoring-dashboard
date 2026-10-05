/**
 * @file stm_diag.h
 * @brief STM→ESP diagnostics: CMD 0x59 alerts + CMD 0x5B health/UI status (integers).
 * Contract: COMPONENT_DIAGNOSTIC_ANALYSIS.md
 */
#ifndef STM_DIAG_H
#define STM_DIAG_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Family IDs (STM 0x01–0x0F; ESP reserves 0x10–0x17) */
#define STM_DIAG_FAM_ST  0x01u  /* framing / command contract */
#define STM_DIAG_FAM_SU  0x02u  /* USART3 STM↔ESP link */
#define STM_DIAG_FAM_SA  0x03u  /* audio / SPI transport */
#define STM_DIAG_FAM_SF  0x04u  /* stream / app flow */
#define STM_DIAG_FAM_SC  0x05u  /* cloud / WiFi via ESP */
#define STM_DIAG_FAM_SS  0x06u  /* STM runtime */
#define STM_DIAG_FAM_SO  0x07u  /* OTA UART */
#define STM_DIAG_FAM_PW  0x08u  /* MP2722 / power */
#define STM_DIAG_FAM_IB  0x09u  /* I2C bus infra */
#define STM_DIAG_FAM_TM  0x0Au  /* temperature probes */
#define STM_DIAG_FAM_AH  0x0Bu  /* DAC / SAI / MDF / mics */
#define STM_DIAG_FAM_DP  0x0Cu  /* display */
#define STM_DIAG_FAM_FM  0x0Du  /* external flash */
#define STM_DIAG_FAM_UB  0x0Eu  /* USB / SpO2 */
#define STM_DIAG_FAM_IO  0x0Fu  /* GPIO / buttons / rails */

/* High-value code IDs used in this pass (immutable once released) */
#define STM_DIAG_ST_01  0x01u
#define STM_DIAG_ST_02  0x02u
#define STM_DIAG_ST_03  0x03u
#define STM_DIAG_ST_04  0x04u
#define STM_DIAG_ST_05  0x05u  /* START mid-frame resync */
#define STM_DIAG_ST_07  0x07u

#define STM_DIAG_SU_01  0x01u
#define STM_DIAG_SU_02  0x02u
#define STM_DIAG_SU_03  0x03u
#define STM_DIAG_SU_04  0x04u
#define STM_DIAG_SU_05  0x05u
#define STM_DIAG_SU_08  0x08u
#define STM_DIAG_SU_10  0x0Au

#define STM_DIAG_SA_01  0x01u
#define STM_DIAG_SA_02  0x02u
#define STM_DIAG_SA_04  0x04u  /* PCM / audio TX queue full — drop */

#define STM_DIAG_SF_03  0x03u
#define STM_DIAG_SF_06  0x06u

#define STM_DIAG_SC_03  0x03u
#define STM_DIAG_SC_04  0x04u
#define STM_DIAG_SC_06  0x06u
#define STM_DIAG_SC_07  0x07u
#define STM_DIAG_SC_10  0x0Au
#define STM_DIAG_SC_12  0x0Cu
#define STM_DIAG_SC_14  0x0Eu  /* RSSI response timeout */
#define STM_DIAG_SC_16  0x10u  /* N consecutive RSSI polls missed */

#define STM_DIAG_SS_07  0x07u
#define STM_DIAG_SS_08  0x08u  /* malloc failed (if hook enabled) */
#define STM_DIAG_SS_11  0x0Bu
#define STM_DIAG_SS_12  0x0Cu
/* STM performance watermarks (threshold events only — not continuous telemetry) */
#define STM_DIAG_SS_20  0x14u  /* FreeRTOS heap used >= 80% */
#define STM_DIAG_SS_21  0x15u  /* FreeRTOS heap used >= 90% */
#define STM_DIAG_SS_22  0x16u  /* Esp32Task stack used >= 80% (HWM) */
#define STM_DIAG_SS_23  0x17u  /* guiTask (TouchGFX) stack used >= 80% (HWM) */
#define STM_DIAG_SS_24  0x18u  /* audioTask stack used >= 80% (HWM) */
#define STM_DIAG_SS_25  0x19u  /* USB_Task stack used >= 80% (HWM) */
#define STM_DIAG_SS_26  0x1Au  /* temp1Task stack used >= 80% (HWM) */
#define STM_DIAG_SS_27  0x1Bu  /* Vitals_Task (SpO2) stack used >= 80% (HWM) */
#define STM_DIAG_SS_28  0x1Cu  /* MP2722Task stack used >= 80% (HWM) */

#define STM_DIAG_SO_03  0x03u

#define STM_DIAG_PW_01  0x01u
#define STM_DIAG_PW_03  0x03u
#define STM_DIAG_PW_04  0x04u
#define STM_DIAG_PW_05  0x05u
#define STM_DIAG_PW_06  0x06u
#define STM_DIAG_PW_07  0x07u
#define STM_DIAG_PW_08  0x08u
#define STM_DIAG_PW_09  0x09u
#define STM_DIAG_PW_10  0x0Au
#define STM_DIAG_PW_11  0x0Bu
#define STM_DIAG_PW_12  0x0Cu
#define STM_DIAG_PW_13  0x0Du
#define STM_DIAG_PW_14  0x0Eu  /* NTC1 WARM */
#define STM_DIAG_PW_15  0x0Fu  /* NTC1 COOL */
#define STM_DIAG_PW_16  0x10u  /* NTC1 COLD */
#define STM_DIAG_PW_17  0x11u  /* NTC1 HOT */
#define STM_DIAG_PW_18  0x12u  /* NTC2 WARM */
#define STM_DIAG_PW_19  0x13u  /* NTC2 COOL */
#define STM_DIAG_PW_20  0x14u  /* NTC2 COLD */
#define STM_DIAG_PW_21  0x15u  /* NTC2 HOT */
#define STM_DIAG_PW_22  0x16u  /* sustained IIN/VIN DPM */

#define STM_DIAG_TM_01  0x01u
#define STM_DIAG_TM_10  0x0Au
#define STM_DIAG_TM_20  0x14u
#define STM_DIAG_TM_30  0x1Eu

#define STM_DIAG_AH_10  0x0Au  /* MDF acquisition overflow */
#define STM_DIAG_AH_11  0x0Bu  /* MDF reshape overrun */
#define STM_DIAG_AH_13  0x0Du  /* MDF saturation / out-of-limit */
#define STM_DIAG_AH_17  0x11u  /* sustained mic imbalance */

#define STM_DIAG_UB_02  0x02u
#define STM_DIAG_UB_03  0x03u
#define STM_DIAG_UB_04  0x04u
#define STM_DIAG_UB_05  0x05u
#define STM_DIAG_UB_06  0x06u
#define STM_DIAG_UB_07  0x07u
#define STM_DIAG_UB_08  0x08u

#define STM_DIAG_IO_10  0x0Au  /* nav button stuck */

/* ACK status (ESP → STM, CMD 0x5A) */
#define STM_DIAG_ACK_ACCEPTED   0x01u
#define STM_DIAG_ACK_DUPLICATE  0x02u
#define STM_DIAG_ACK_INVALID    0x03u
#define STM_DIAG_ACK_BUSY       0x04u

/* CMD 0x5B kind */
#define STM_STATUS_KIND_HEALTH   0u  /* periodic system health */
#define STM_STATUS_KIND_UI       1u  /* screen enter / button / action */

/* UI action codes (immutable once released) */
#define STM_UI_ACTION_NONE           0u
#define STM_UI_ACTION_SCREEN_ENTER   1u
#define STM_UI_ACTION_HOME_SELECT   10u
#define STM_UI_ACTION_HOME_BACK     11u
#define STM_UI_ACTION_EXAM_SELECT   20u
#define STM_UI_ACTION_TEMP_SAMPLE   30u
#define STM_UI_ACTION_TEMP_SAVE     31u
#define STM_UI_ACTION_STREAM_START  40u
#define STM_UI_ACTION_STREAM_STOP   41u
#define STM_UI_ACTION_AUS_BACK      42u
#define STM_UI_ACTION_QR_NAV        50u

#define STM_UI_BUTTON_NONE  255u

typedef struct
{
    uint8_t family_id;
    uint8_t code_id;
    uint8_t repeat_count;
    uint16_t session_id;
    uint16_t sequence_id;
    uint32_t first_occurrence_tick;
} stm_diag_event_t;

void STM_Diag_Init(void);
void STM_Diag_Report(uint8_t family_id, uint8_t code_id);
void STM_Diag_Clear(uint8_t family_id, uint8_t code_id);
void STM_Diag_SetUartPaused(uint8_t paused);
uint8_t STM_Diag_IsUartPaused(void);
void STM_Diag_Process(void);
void STM_Diag_HandleAck(uint16_t session_id, uint16_t sequence_id, uint8_t status);
uint16_t STM_Diag_GetSessionId(void);
uint8_t STM_Diag_QueueCount(void);
/** Watermark codes SS-20..28 + drain UI queue + periodic 0x5B health. */
void STM_Diag_PerfPoll(void);

/** Latch UI screen-enter event (sent as 0x5B kind=UI). Safe from GUI task. */
void STM_Diag_NotifyScreenEnter(uint8_t screen);
/** Latch button press; action from STM_UI_ACTION_* (0 = button only). */
void STM_Diag_NotifyButton(uint8_t button, uint8_t action);
/** Latch named action (e.g. stream start) with optional button. */
void STM_Diag_NotifyAction(uint8_t action, uint8_t button);

#ifdef __cplusplus
}
#endif

#endif /* STM_DIAG_H */
