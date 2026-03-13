import { createHmac } from 'crypto';
import { findUserByEmail, linkStripeCustomer, jsonResponse } from '../../lib/auth-utils.js';
import { sendConversionEmail } from '../../lib/email-utils.js';

// Stripe webhook handler
// Receives events from Stripe and links payments to user accounts
// Set STRIPE_WEBHOOK_SECRET in Netlify env vars

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    // If webhook secret is set, verify signature
    if (webhookSecret && sig) {
      stripeEvent = verifyStripeSignature(event.body, sig, webhookSecret);
    } else {
      stripeEvent = JSON.parse(event.body);
    }
  } catch (err) {
    console.error('[STRIPE-WEBHOOK] Signature verification failed:', err.message);
    return jsonResponse({ error: 'Invalid signature' }, 400);
  }

  const eventType = stripeEvent.type;
  const data = stripeEvent.data?.object;

  console.log(`[STRIPE-WEBHOOK] Received event: ${eventType}`);

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        const rawEmail = data.customer_email || data.customer_details?.email;
        const email = rawEmail ? String(rawEmail).toLowerCase().trim() : null;
        const customerId = data.customer;
        const plan = extractPlanFromSession(data);
        const name = data.customer_details?.name || '';

        if (email) {
          await linkStripeCustomer(email, customerId, plan, name);

          // Send conversion email
          await sendConversionEmail({
            eventType: 'Payment Completed',
            userEmail: email,
            userName: data.customer_details?.name || '',
            plan: plan,
            details: `Stripe session: ${data.id}, Amount: ${formatAmount(data.amount_total, data.currency)}`,
          });
        }
        break;
      }

      case 'customer.subscription.created': {
        const customerId = data.customer;
        const plan = extractPlanFromSubscription(data);

        await sendConversionEmail({
          eventType: 'Subscription Created',
          userEmail: customerId,
          plan: plan,
          details: `Status: ${data.status}, Period: ${data.current_period_start ? new Date(data.current_period_start * 1000).toISOString() : 'N/A'}`,
        });
        break;
      }

      case 'customer.subscription.updated': {
        const plan = extractPlanFromSubscription(data);

        await sendConversionEmail({
          eventType: 'Subscription Updated',
          userEmail: data.customer,
          plan: plan,
          details: `Status: ${data.status}, Cancel at period end: ${data.cancel_at_period_end}`,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        await sendConversionEmail({
          eventType: 'Subscription Cancelled',
          userEmail: data.customer,
          details: `Subscription ${data.id} cancelled`,
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        const email = data.customer_email;
        const amount = formatAmount(data.amount_paid, data.currency);

        if (email) {
          await sendConversionEmail({
            eventType: 'Invoice Payment Succeeded',
            userEmail: email,
            details: `Amount: ${amount}, Invoice: ${data.id}`,
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const email = data.customer_email;

        if (email) {
          await sendConversionEmail({
            eventType: 'Invoice Payment Failed',
            userEmail: email,
            details: `Invoice: ${data.id}, Attempt: ${data.attempt_count}`,
          });
        }
        break;
      }

      default:
        console.log(`[STRIPE-WEBHOOK] Unhandled event type: ${eventType}`);
    }

    return jsonResponse({ received: true });
  } catch (err) {
    console.error(`[STRIPE-WEBHOOK] Error processing ${eventType}:`, err);
    return jsonResponse({ error: 'Webhook processing error' }, 500);
  }
}

// Simple Stripe signature verification (without stripe-node dependency)
function verifyStripeSignature(payload, signature, secret) {
  const elements = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = elements.t;
  const expectedSig = elements.v1;

  const signedPayload = `${timestamp}.${payload}`;
  const computedSig = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  if (computedSig !== expectedSig) {
    throw new Error('Signature mismatch');
  }

  // Check timestamp tolerance (5 minutes)
  const tolerance = 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > tolerance) {
    throw new Error('Timestamp outside tolerance');
  }

  return JSON.parse(payload);
}

function extractPlanFromSession(session) {
  if (session.metadata?.plan) return session.metadata.plan;

  let amount = session.amount_total;
  if (!amount && session.line_items?.data?.length) {
    const first = session.line_items.data[0];
    amount = first.price?.unit_amount ?? first.amount_total;
  }
  if (amount) {
    const dollars = amount / 100;
    if (dollars <= 29) return 'Explorer';
    if (dollars <= 99) return 'Investor';
    if (dollars <= 299) return 'Professional';
  }

  return 'Unknown';
}

function extractPlanFromSubscription(subscription) {
  if (subscription.metadata?.plan) return subscription.metadata.plan;

  const item = subscription.items?.data?.[0];
  if (item?.price?.unit_amount) {
    const dollars = item.price.unit_amount / 100;
    if (dollars <= 29) return 'Explorer';
    if (dollars <= 99) return 'Investor';
    if (dollars <= 299) return 'Professional';
  }

  return 'Unknown';
}

function formatAmount(amount, currency) {
  if (!amount) return 'N/A';
  const dollars = amount / 100;
  return `${currency?.toUpperCase() || 'USD'} ${dollars.toFixed(2)}`;
}
