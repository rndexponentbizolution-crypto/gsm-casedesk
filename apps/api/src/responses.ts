import {
  GSM_BACKOFFICE_EMAIL as EMAIL,
  type QueryTypeKey,
} from './query-types';

/**
 * Standard WhatsApp responses from the GSM BO SOP pack ("WhatsApp responses"
 * and "Feedback & Responses"). Each response carries the effect sending it has
 * on the ticket, so the outcome is recorded consistently with the SOP.
 *
 * Placeholders: {name} = the field agent's first name.
 */

export type ResponseEffect =
  /** Request accepted: start the clock on processing. */
  | { kind: 'acknowledge' }
  /** Resolved successfully. */
  | { kind: 'resolve'; outcome: string }
  /** Closed without resolution (unsuccessful / rejected). */
  | { kind: 'close'; outcome: string }
  /** Waiting on the field agent to resubmit or provide something. */
  | { kind: 'pending'; outcome: string }
  /** Escalated by email to the GSM back office with a fixed subject line. */
  | {
      kind: 'escalate';
      subject: string;
      attachments: string[];
      queryType?: QueryTypeKey;
      slaHours: number;
    }
  /** Redirect a non-PIN-reset request to email (channel policy). */
  | { kind: 'redirect_email' }
  /** Informational / follow-up: no status change. */
  | { kind: 'info' };

export type ResponseCategory =
  | 'Acknowledge'
  | 'Successful'
  | 'Call outcome'
  | 'Escalation required'
  | 'Documents & ID'
  | 'Number & account'
  | 'Follow-up'
  | 'Redirect';

export interface StandardResponse {
  id: string;
  title: string;
  category: ResponseCategory;
  body: string;
  effect: ResponseEffect;
  /** Only relevant to these query types (omitted = any). */
  queryTypes?: QueryTypeKey[];
}

const NRC = 'NRC (front & back)';
const LIVE = 'Live facial image';
const AFFIDAVIT = 'Court-issued affidavit (within 3 months)';
const ADDRESS = 'Customer address';

const PIN: QueryTypeKey[] = ['PIN_RESET', 'PIN_RESET_ABOVE_THRESHOLD'];

export const RESPONSES: StandardResponse[] = [
  // ---------------- Acknowledge ----------------
  {
    id: 'ack-pin-reset',
    title: 'Acknowledge PIN reset',
    category: 'Acknowledge',
    queryTypes: PIN,
    effect: { kind: 'acknowledge' },
    body: `Y'ello,
Thank you for contacting GSM Support regarding your PIN reset. Your request has been received and will be processed within 3 minutes.
Please advise the customer to remain available and keep their phone on and close by, as they will receive a call from our team within this period to assist with the PIN reset.
Have a Y'ello day.`,
  },
  {
    id: 'ack-network-challenges',
    title: 'Acknowledged (network challenges)',
    category: 'Acknowledge',
    effect: { kind: 'acknowledge' },
    body: `Y'ello,
Kindly note that your PIN reset request has been acknowledged. We will ensure that it is worked on and feedback with updates will be provided once the work is completed. We appreciate your patience.
Have a Y'ello day.`,
  },

  // ---------------- Successful ----------------
  {
    id: 'success-pin-reset',
    title: 'Successful PIN reset',
    category: 'Successful',
    queryTypes: PIN,
    effect: { kind: 'resolve', outcome: 'Successful PIN reset' },
    body: `Y'ello,
Your PIN reset request has been processed successfully.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'success-sim-verification',
    title: 'SIM verification successful',
    category: 'Successful',
    effect: { kind: 'resolve', outcome: 'SIM verification successful' },
    body: `Y'ello {name},
Thank you for contacting GSM Support!
Your request for SIM verification has been successfully processed.
The details have been verified and updated in the system.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'already-assisted',
    title: 'Customer already assisted',
    category: 'Successful',
    queryTypes: PIN,
    effect: { kind: 'resolve', outcome: 'Already assisted' },
    body: `Y'ello,
Kindly note that the customer was already assisted and the PIN was reset successfully.
Have a Y'ello day!`,
  },

  // ---------------- Call outcome ----------------
  {
    id: 'call-not-answering',
    title: 'Customer not answering call',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'close', outcome: 'Customer not answering call' },
    body: `Y'ello,
Kindly note that the PIN reset was unsuccessful due to the customer not answering the phone call. Kindly advise the customer to answer the phone call from 115 to be assisted.
Have a Y'ello day.`,
  },
  {
    id: 'call-no-response',
    title: 'Customer did not respond on call',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'close', outcome: 'Customer did not respond during call' },
    body: `Y'ello,
Kindly note that the PIN reset was unsuccessful as the customer answered the call but did not respond during the conversation.
Kindly advise the customer to actively respond when contacted from 115 to be assisted.
Have a Y'ello day!`,
  },
  {
    id: 'call-phone-off',
    title: "Customer's phone is off",
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'pending', outcome: "Customer's phone is off" },
    body: `Y'ello,
Kindly note that we are unable to initiate the PIN reset as the customer's phone is off. Please advise the customer to keep the phone on in order for us to proceed.
Have a Y'ello day.`,
  },
  {
    id: 'call-hung-up',
    title: 'Customer hung up / cutting the line',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'close', outcome: 'Customer hung up' },
    body: `Y'ello,
Kindly note that the customer keeps cutting the line. Please advise the customer to answer the call from 115 and cooperate for better assistance.
Have a Y'ello day.`,
  },
  {
    id: 'call-language-barrier',
    title: 'Language barrier',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'pending', outcome: 'Language barrier' },
    body: `Y'ello,
Kindly note that the PIN reset could not be completed due to a language barrier.
The customer will be contacted again once an agent who speaks their preferred language is available.
Have a Y'ello day!`,
  },
  {
    id: 'call-security-questions',
    title: 'Unable to answer security questions',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'close', outcome: 'Failed security questions' },
    body: `Y'ello,
Kindly note that the customer was unable to answer the required security questions during the PIN reset process.
Please advise the customer to visit the nearest MTN Service Centre for further assistance.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'call-info-mismatch',
    title: 'Information not provided / mismatch',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'close', outcome: 'Customer details mismatch on call' },
    body: `Y'ello,
Kindly note that the customer was unable to provide the required information, as the details shared are different from those captured in the system.
Kindly advise the customer to visit the nearest MTN Service Centre for further assistance.
Have a Y'ello day!`,
  },
  {
    id: 'call-unreachable',
    title: 'Customer unreachable',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'pending', outcome: 'Customer unreachable' },
    body: `Y'ello,
Kindly note that the request could not be completed as the customer was unreachable when contacted.
Please follow up with the customer once they are available to proceed.
Have a Y'ello day!`,
  },
  {
    id: 'call-microphone',
    title: 'Microphone / audio issue',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'pending', outcome: 'Microphone issue on customer device' },
    body: `Y'ello,
Kindly note that the PIN reset was unsuccessful. Although the customer answered the call, there was no audible response from their side. The feedback received indicates that the customer's device microphone is producing a distorted "network struggle" sound, suggesting a possible audio malfunction on the handset.
Kindly advise the customer to try using a different phone, as the current device may have a microphone issue.
Thank you for your cooperation.`,
  },
  {
    id: 'call-owner-not-around',
    title: 'Owner not around',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'close', outcome: 'Owner not around' },
    body: `Y'ello,
Kindly note that your PIN reset request was unsuccessful because the customer is not around.
Have a Y'ello day!`,
  },
  {
    id: 'prompt-already-sent',
    title: 'PIN prompt already sent',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'pending', outcome: 'PIN prompt already sent' },
    body: `Y'ello,
Thank you for following up.
Kindly note that the PIN reset prompt has already been sent.
Please advise the customer to change their phone and then request for the prompt to be resent.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'prompt-three-times',
    title: 'Prompt sent more than 3 times',
    category: 'Call outcome',
    queryTypes: PIN,
    effect: { kind: 'close', outcome: 'Prompt sent more than three times' },
    body: `Y'ello,
Kindly try again later, as the prompt has been sent more than three times.
Have a Y'ello day!`,
  },

  // ---------------- Escalation required ----------------
  {
    id: 'esc-above-threshold',
    title: 'PIN reset above threshold (> K5,000)',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'PIN Reset Above Threshold',
      attachments: [NRC, LIVE],
      queryType: 'PIN_RESET_ABOVE_THRESHOLD',
      slaHours: 24,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as the amount exceeds the allowable limit.
Please request for "PIN Reset Above Threshold" and attach the customer's NRC (front & back) and live facial image to ${EMAIL} for escalation.
Have a Y'ello day!`,
  },
  {
    id: 'esc-sim-swap',
    title: 'SIM swap profile flagged',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'SIM Swap Approval',
      attachments: [NRC, LIVE],
      queryType: 'SIM_SWAP_APPROVAL',
      slaHours: 72,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as the account is flagged under a SIM swap profile.
Please request for "SIM Swap Approval" and attach the customer's NRC (front & back) and live facial image to ${EMAIL}
Have a Y'ello day!`,
  },
  {
    id: 'esc-fraud-profile',
    title: 'Fraud prevention profile',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'Fraud Prevention Profile Change',
      attachments: [NRC, LIVE, 'Written request'],
      slaHours: 24,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as the account is under a fraud prevention profile.
Please request for "Fraud Prevention Profile Change" and attach the customer's NRC (front & back), live facial image, and a written request to ${EMAIL} for escalation.
Have a Y'ello day!`,
  },
  {
    id: 'esc-incomplete-registration',
    title: 'Incomplete registration',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'SIM Verification',
      attachments: [NRC, LIVE, ADDRESS],
      queryType: 'SIM_VERIFICATION',
      slaHours: 24,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as the customer's registration is incomplete.
Please request for "SIM Verification" and attach the customer's NRC (front & back), live facial image, and address to ${EMAIL} for verification.
Have a Y'ello day!`,
  },
  {
    id: 'esc-affidavit-nrc',
    title: 'Affidavit required: NRC change',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'Change of Details',
      attachments: [AFFIDAVIT, NRC, LIVE, ADDRESS],
      queryType: 'CHANGE_OF_DETAILS',
      slaHours: 72,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as an affidavit is required to change the NRC details.
Please request for "Change of Details" and attach the affidavit, customer's NRC (front & back), live facial image, and address to ${EMAIL}
Have a Y'ello day!`,
  },
  {
    id: 'esc-affidavit-dob',
    title: 'Affidavit required: date of birth',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'Change of Details',
      attachments: [AFFIDAVIT, NRC, LIVE, ADDRESS],
      queryType: 'CHANGE_OF_DETAILS',
      slaHours: 72,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as an affidavit is required to update the date of birth on MoMo.
Please request for "Change of Details" and attach the affidavit, customer's NRC (front & back), live facial image, and address to ${EMAIL}
Have a Y'ello day!`,
  },
  {
    id: 'esc-affidavit-sim-momo',
    title: 'Affidavit required: SIM & MoMo mismatch',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'Change of Details',
      attachments: [AFFIDAVIT, NRC, LIVE, ADDRESS],
      queryType: 'CHANGE_OF_DETAILS',
      slaHours: 72,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as an affidavit is required to change details on both SIM registration and MoMo.
Please request for "Change of Details" and attach the affidavit, customer's NRC (front & back), live facial image, and address to ${EMAIL}
Have a Y'ello day!`,
  },
  {
    id: 'esc-live-picture-mismatch',
    title: 'Live picture does not match',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'Change of Details',
      attachments: [AFFIDAVIT, NRC, LIVE, ADDRESS],
      queryType: 'CHANGE_OF_DETAILS',
      slaHours: 72,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as the live picture does not match our system records.
Please request for "Change of Details" and attach an affidavit, the customer's NRC (front & back), live facial image, and address to ${EMAIL}
Have a Y'ello day!`,
  },
  {
    id: 'esc-no-momo',
    title: 'No MoMo account found',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'MoMo Activation',
      attachments: [NRC, LIVE],
      queryType: 'MOMO_ACTIVATION',
      slaHours: 72,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as no MoMo account is linked to this number.
Please request for "MoMo Activation" and attach the customer's NRC (front & back) and live facial image to ${EMAIL} for escalation.
Have a Y'ello day!`,
  },
  {
    id: 'esc-blocked',
    title: 'MoMo account blocked',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'MoMo Account Unblocking',
      attachments: [NRC, LIVE, 'Signed letter'],
      queryType: 'MOMO_UNBLOCKING',
      slaHours: 24,
    },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as the MoMo account is blocked.
Please request for "MoMo Account Unblocking" and attach the customer's NRC (front & back), live facial image, and a signed letter to ${EMAIL} for escalation.
Have a Y'ello day!`,
  },
  {
    id: 'esc-agent-line',
    title: 'Agent line authorization required',
    category: 'Escalation required',
    queryTypes: PIN,
    effect: {
      kind: 'escalate',
      subject: 'Agent Line Authorization',
      attachments: ['Area representative approval'],
      slaHours: 72,
    },
    body: `Y'ello,
Your PIN reset was unsuccessful as this is an agent line and requires authorization from the area representative. Please contact your area representative to obtain approval and resubmit your request to ${EMAIL}.
Have a Y'ello day!`,
  },
  {
    id: 'esc-system-error',
    title: 'Live facial update: system error',
    category: 'Escalation required',
    effect: {
      kind: 'escalate',
      subject: 'System Error — Escalation',
      attachments: ['Error details', 'Query details'],
      slaHours: 72,
    },
    body: `Y'ello,
Thank you for your request. We attempted to update the live facial image, but the system is currently returning an error, and we are unable to process the change at this moment. The issue has been escalated, and we will provide an update as soon as feedback is available. Your patience will be greatly appreciated.
Have a Y'ello day.`,
  },
  {
    id: 'escalated-partners',
    title: 'Escalated to partners (72h)',
    category: 'Escalation required',
    effect: {
      kind: 'escalate',
      subject: 'Escalated to partners',
      attachments: [],
      slaHours: 72,
    },
    body: `Y'ello,
Kindly note that your request has been escalated to our partners for further handling.
Please expect feedback within 72 hours.
Thank you for your cooperation.
Have a Y'ello day!`,
  },

  // ---------------- Documents & ID ----------------
  {
    id: 'doc-missing-live-nrc',
    title: 'Missing live facial / NRC',
    category: 'Documents & ID',
    effect: { kind: 'pending', outcome: 'Missing live facial / NRC images' },
    body: `Y'ello,
Kindly attach the customer's live facial and NRC images (front and back).
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'doc-nrc-required',
    title: 'NRC required',
    category: 'Documents & ID',
    effect: { kind: 'pending', outcome: 'NRC required' },
    body: `Y'ello,
Kindly share the customer's NRC to proceed with your request.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'doc-original-nrc',
    title: 'Original hard copy NRC required',
    category: 'Documents & ID',
    effect: { kind: 'pending', outcome: 'Original hard copy NRC required' },
    body: `Y'ello,
Kindly note that only original hard copy images of the NRC are acceptable for this process.
Please advise the customer to share a clear image of the original hard copy NRC to enable us to proceed.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'doc-not-in-store',
    title: 'Live photo not inside MTN store',
    category: 'Documents & ID',
    effect: { kind: 'pending', outcome: 'Live photo not taken in store' },
    body: `Y'ello,
Your PIN reset was unsuccessful as the live facial image does not show the customer inside an MTN Store. Please resubmit your request with a live facial image (taken inside an MTN Store with the store background clearly visible).
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'doc-invalid-id',
    title: 'Invalid identification document',
    category: 'Documents & ID',
    effect: { kind: 'pending', outcome: 'Invalid identification document' },
    body: `Y'ello,
Thank you for contacting GSM SUPPORT regarding your PIN reset.
Kindly note that your request was unsuccessful as the identification provided is not acceptable. Only a valid NRC or Passport is required for this process.
Please resubmit the request with the correct document to proceed.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'doc-visa-permit',
    title: 'Visa / permit required',
    category: 'Documents & ID',
    effect: { kind: 'pending', outcome: 'Visa or permit required' },
    body: `Y'ello,
Kindly advise the customer to provide a valid/active Visa or Permit in order to proceed with the request.
Thank you for your cooperation.`,
  },
  {
    id: 'doc-nrc-unclear',
    title: 'NRC not clear: renewal required',
    category: 'Documents & ID',
    effect: { kind: 'close', outcome: 'Rejected: NRC not clear' },
    body: `Y'ello,
Kindly note that the request was rejected.
The submitted NRC copy is not clear and cannot be verified.
Kindly advise the customer to obtain a renewed NRC to proceed with the request.
Thank you for your patience.
Have a Y'ello day!`,
  },
  {
    id: 'doc-nrc-damaged',
    title: 'Damaged / open NRC',
    category: 'Documents & ID',
    effect: { kind: 'close', outcome: 'Rejected: damaged NRC' },
    body: `Y'ello,
Kindly note that the request was rejected.
The submitted NRC appears damaged/open and cannot be verified.
Kindly advise the customer to obtain a renewed NRC to proceed with the request.
Thank you for your patience.
Have a Y'ello day!`,
  },
  {
    id: 'doc-nrc-portrait',
    title: 'NRC facial portrait unclear',
    category: 'Documents & ID',
    effect: { kind: 'close', outcome: 'Rejected: NRC portrait unclear' },
    body: `Y'ello,
Kindly note that the request was rejected. The submitted NRC copy is not clear (the facial portrait on the NRC cannot be verified).
Kindly advise the customer to obtain a renewed NRC to proceed with the request.
Thank you for your patience.
Have a Y'ello day!`,
  },
  {
    id: 'doc-nrc-unauthentic-portrait',
    title: 'Unauthentic NRC portrait',
    category: 'Documents & ID',
    effect: { kind: 'close', outcome: 'Rejected: unauthentic NRC portrait' },
    body: `Y'ello,
Kindly note that the request was rejected. The submitted NRC facial portrait appears unauthentic and cannot be verified.
Please advise the customer to obtain a renewed NRC to proceed with the request.
Thank you for your patience.
Have a Y'ello day!`,
  },
  {
    id: 'doc-nrc-tampered',
    title: 'Altered / tampered NRC',
    category: 'Documents & ID',
    effect: { kind: 'close', outcome: 'Rejected: tampered NRC (fraud flag)' },
    body: `Y'ello,
Kindly note that the request was rejected.
The submitted NRC appears altered or unauthentic, as the ID number has been scratched off and the facial portrait appears tampered with, making it impossible to verify.
Kindly advise the customer to obtain a renewed NRC to proceed with the request.`,
  },
  {
    id: 'doc-police-affidavit',
    title: 'Incorrect affidavit (police-issued)',
    category: 'Documents & ID',
    effect: { kind: 'close', outcome: 'Rejected: police-issued affidavit' },
    body: `Y'ello {name},
Kindly note that the request has been rejected.
For a change of details, only a court-issued affidavit is acceptable. The document provided is a police-issued affidavit, which does not meet the required standards.
Kindly advise the customer to obtain a court-issued affidavit stating the request for the change of details and the reason for the change.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'doc-invalid-affidavit',
    title: 'Invalid / altered affidavit date',
    category: 'Documents & ID',
    effect: {
      kind: 'close',
      outcome: 'Rejected: invalid affidavit (fraud flag)',
    },
    body: `Y'ello {name},
The request was rejected. Kindly note that the submitted affidavit shows an altered or out-of-date written/typed date, which is not valid for processing.
Please ensure to watch out for such alterations, as they are considered a fraud flag. The customer must provide a valid, unaltered affidavit issued within the last 3 months, with both the date stamp and the printed/typed date matching.
Have a Y'ello day!`,
  },
  {
    id: 'doc-agent-line-originals',
    title: 'Agent line upgrade: originals required',
    category: 'Documents & ID',
    effect: { kind: 'pending', outcome: 'Original documents required' },
    body: `Y'ello,
Thank you for contacting GSM Support!
Your request for an agent line upgrade was not successfully processed. The attached documents provided appear to be scanned or photocopied, and we require original documents. To proceed, please submit the following:
- Specify customer request type (agent line upgrade)
- A live image of the customer
- Original customer's NRC (front and back) images
- Customer's address
Once these documents are verified, we will update your request in the system. Thank you for your cooperation.
Have a Y'ello day!`,
  },

  // ---------------- Number & account ----------------
  {
    id: 'num-incorrect',
    title: 'Incorrect phone number',
    category: 'Number & account',
    effect: { kind: 'pending', outcome: 'Incorrect phone number' },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as the provided phone number is incorrect.
Please share the correct customer phone number.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'num-terminated',
    title: 'Terminated number',
    category: 'Number & account',
    effect: { kind: 'close', outcome: 'Rejected: terminated number' },
    body: `Y'ello,
Kindly note that the request was rejected.
The provided number is terminated on the system and cannot be processed.
Kindly advise the customer to register a new SIM card to remain connected to the network.
Thank you for your patience.
Have a Y'ello day!`,
  },
  {
    id: 'num-rejected-registration',
    title: 'Rejected registration',
    category: 'Number & account',
    effect: { kind: 'close', outcome: 'Rejected registration' },
    body: `Y'ello,
Kindly note that your PIN reset request was unsuccessful as this number's registration was rejected. Kindly advise the customer to have it re-registered.
Thank you for your cooperation.
Have a Y'ello day!`,
  },
  {
    id: 'num-corporate',
    title: 'Corporate number',
    category: 'Number & account',
    effect: { kind: 'close', outcome: 'Corporate number' },
    body: `Y'ello,
Kindly note that your PIN reset was unsuccessful as this is a corporate number.
Please advise the customer to follow up with their company's HR.
Have a Y'ello day!`,
  },
  {
    id: 'num-info-mismatch',
    title: 'Information mismatch: resubmit',
    category: 'Number & account',
    effect: { kind: 'pending', outcome: 'Information mismatch' },
    body: `Y'ello,
Kindly note that we are unable to proceed with your request at this time due to a mismatch between the information you provided and the records in our system.
We kindly request you to verify the details and resubmit the correct information so that we can assist you promptly.
Thank you for your cooperation.
Have a Y'ello day!`,
  },

  // ---------------- Follow-up ----------------
  {
    id: 'follow-reprocessing',
    title: 'Re-processing PIN reset',
    category: 'Follow-up',
    effect: { kind: 'info' },
    body: `Y'ello,
Thank you for following up. Your PIN reset request is currently being re-processed.
We appreciate your patience and will keep you updated.
Have a Y'ello day!`,
  },
  {
    id: 'follow-working-on-it',
    title: 'Still working on it',
    category: 'Follow-up',
    effect: { kind: 'info' },
    body: `Y'ello,
Thank you for following up. We're working on your request and will be in touch with an update as soon as it's completed. We appreciate your patience.
Have a Y'ello day!`,
  },
  {
    id: 'follow-specify-query',
    title: 'Please specify your query',
    category: 'Follow-up',
    effect: { kind: 'pending', outcome: 'Query not specified' },
    body: `Y'ello,
Kindly specify your query for further assistance.
Have a Y'ello day!`,
  },
  {
    id: 'follow-forwarded',
    title: 'Forwarded request not accepted',
    category: 'Follow-up',
    effect: { kind: 'close', outcome: 'Rejected: forwarded request' },
    body: `Y'ello,
Kindly note that we do not process forwarded requests.
Please ensure the request is sent directly from the registered WhatsApp line or authorized contact.
Have a Y'ello day!`,
  },

  // ---------------- Redirect ----------------
  {
    id: 'redirect-email',
    title: 'Email submission required',
    category: 'Redirect',
    effect: { kind: 'redirect_email' },
    body: `Y'ello,
Thank you for contacting GSM SUPPORT regarding your request.
Kindly share it via email to ${EMAIL}
Have a Y'ello day!`,
  },
  {
    id: 'redirect-service-centre',
    title: 'Visit service centre',
    category: 'Redirect',
    effect: { kind: 'close', outcome: 'Referred to service centre' },
    body: `Y'ello,
Thank you for reaching out to Connect Stores. For such queries, kindly advise the customer to visit the service centre for further assistance.
Have a Y'ello day!`,
  },
];

export const RESPONSE_BY_ID = new Map(
  RESPONSES.map((response) => [response.id, response]),
);

export function fillTemplate(body: string, vars: { name?: string }) {
  return body.replace(/\{name\}/g, vars.name ?? '').replace(/ ,/g, ',');
}
