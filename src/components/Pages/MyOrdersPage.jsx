import { OrderReference } from '../Common/OrderReference';
import { useEffect, useState } from 'react';
import { OrderDesignFiles } from '../Common/OrderDesignFiles';
import { ProductionProgress } from '../Common/ProductionProgress';
import { store } from '../../utils/storage';
import { Btn } from '../Common/Btn';
import { Badge } from '../Common/Badge';
import { Input } from '../Common/Input';
import { Modal } from '../Common/Modal';
import { PaymentSubmissionModal } from './PaymentSubmissionModal';
import { apiUrl, orderApi } from '../../utils/orderApi';
import './MyOrdersPage.css';

const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);
const date = value => value ? new Date(value).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not recorded';
const paymentTone = status => String(status || 'Unpaid').toLowerCase().replace(/\s+/g, '-');
const specificationRows = order => {
  const sources = [order.specs, order.designNotes && order.designNotes !== order.specs ? order.designNotes : ''].filter(Boolean);
  const rows = [], seen = new Set();
  for (const source of sources) {
    for (const entry of String(source).split(/\r?\n|\s*\|\s*/).map(value => value.trim()).filter(Boolean)) {
      const match = entry.match(/^([^:]{1,40}):\s*(.+)$/);
      const label = match ? match[1].trim() : 'Instructions';
      const value = match ? match[2].trim() : entry;
      const key = `${label.toLowerCase()}\u0000${value.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); rows.push({ label, value }); }
    }
  }
  return rows;
};

export const MyOrdersPage = ({ user, setPage, showToast }) => {
  const [reviewModal, setReviewModal] = useState(null);
  const [review, setReview] = useState({ rating: 5, comment: '' });
  const [submittingReview, setSubmittingReview] = useState(false);
  const [myOrders, setMyOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState('');
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [inquiries, setInquiries] = useState([]);
  const [inquiryLoading, setInquiryLoading] = useState(true);
  const [inquiryError, setInquiryError] = useState('');
  const [selectedInquiryId, setSelectedInquiryId] = useState(null);
  const [inquiryReply, setInquiryReply] = useState('');
  const [inquirySending, setInquirySending] = useState(false);
  const [inquiryRequestId, setInquiryRequestId] = useState('');

  useEffect(() => {
    let active = true, pending = false;
    setMyOrders([]); setLoadingOrders(true);
    const fetchMyOrders = async () => {
      if (pending) return;
      pending = true;
      try {
        let token = user?.token || '';
        if (user?.authProvider === 'supabase') {
          const { supabase } = await import('../../utils/supabaseClient');
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          token = data.session?.access_token || '';
        } else if (!token) token = (await store.get('session'))?.token || '';
        if (!token) throw new Error('Please login to view your orders.');
        const response = await fetch(apiUrl('/api/customers/orders'), { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to load your orders.');
        if (active) { setMyOrders(Array.isArray(data.orders) ? data.orders : []); setOrdersError(''); }
      } catch (error) {
        if (active) { setMyOrders([]); setOrdersError(error.message || 'Unable to load your orders.'); }
      } finally { pending = false; if (active) setLoadingOrders(false); }
    };
    fetchMyOrders();
    const timer = setInterval(fetchMyOrders, 5000);
    window.addEventListener('focus', fetchMyOrders);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', fetchMyOrders); };
  }, [user]);

  useEffect(() => {
    let active = true, pending = false;
    const load = async () => {
      if (pending) return; pending = true;
      try {
        const data = await orderApi('/api/customers/inquiries', {}, user);
        if (active) { setInquiries(Array.isArray(data.messages) ? data.messages : []); setInquiryError(''); }
      } catch (error) { if (active) { setInquiries([]); setInquiryError(error.message || 'Unable to load your inquiries.'); } }
      finally { pending = false; if (active) setInquiryLoading(false); }
    };
    if (user?.role === 'customer') { load(); const timer = setInterval(load, 10000); window.addEventListener('focus', load); return () => { active = false; clearInterval(timer); window.removeEventListener('focus', load); }; }
    setInquiryLoading(false); return () => { active = false; };
  }, [user]);

  const submitReview = async () => {
    if (!review.comment.trim()) return showToast('Please write a comment', 'error');
    setSubmittingReview(true);
    const existing = (await store.get('reviews')) || [];
    await store.set('reviews', [...existing, { name: user.name, rating: review.rating, comment: review.comment, product: reviewModal.product, date: new Date().toISOString().split('T')[0], orderId: reviewModal.id }]);
    showToast('Review submitted. Thank you!', 'success');
    setReviewModal(null); setReview({ rating: 5, comment: '' }); setSubmittingReview(false);
  };
  const handlePaymentSubmitted = updatedOrder => {
    setMyOrders(current => current.map(order => order.id === updatedOrder.id ? { ...order, ...updatedOrder } : order));
    setPaymentOrder(null);
  };
  const selectedInquiry = inquiries.find(item => item.id === selectedInquiryId);
  const sendInquiryReply = async () => {
    const message = inquiryReply.trim();
    if (!selectedInquiry || !message || inquirySending) return;
    const stableId = inquiryRequestId || crypto.randomUUID();
    setInquiryRequestId(stableId); setInquirySending(true); setInquiryError('');
    try {
      const data = await orderApi(`/api/customers/inquiries/${encodeURIComponent(selectedInquiry.id)}/replies`, { method: 'POST', body: JSON.stringify({ requestId: stableId, message }) }, user);
      setInquiries(items => items.map(item => item.id === data.message.id ? data.message : item));
      setInquiryReply(''); setInquiryRequestId('');
      showToast?.('Reply sent.', 'success');
    } catch (error) { setInquiryError(error.message || 'Unable to send your reply.'); }
    finally { setInquirySending(false); }
  };

  return <main className="bm-my-orders fade-in">
    <header className="bm-my-orders__heading"><div><span>Customer workspace</span><h1>My Orders</h1><p>Track payment, production, and pickup progress in one place.</p></div>{user?.role === 'customer' && <a className="bm-inquiries-nav" href="#my-inquiries">My Inquiries</a>}</header>
    {new URLSearchParams(window.location.search).has('payment_return') && <p role="status" className="bm-order-payment-notice">You have returned from checkout. This does not confirm payment. Payment remains subject to manual verification.</p>}
    {loadingOrders ? <div className="bm-my-orders__state">Loading your orders…</div>
      : ordersError ? <div className="bm-my-orders__state is-error" role="alert">{ordersError}</div>
      : !myOrders.length ? <div className="bm-my-orders__state"><h2>No orders yet</h2><p>Your orders will appear here after you place your first order.</p><Btn onClick={() => setPage('order')}>Place an Order</Btn></div>
      : <div className="bm-order-list">{myOrders.map(order => {
        const paymentStatus = order.paymentStatus || 'Unpaid';
        const specs = specificationRows(order);
        return <article className="bm-order-card" key={order.id}>
          <header className="bm-order-card__header">
            <div className="bm-order-card__identity"><span>Order number</span><h2>{order.id}</h2><p><strong>{order.product}</strong><span>{order.quantity} pcs</span><span>{date(order.createdAt || order.date)}</span></p></div>
            <div className="bm-order-card__summary"><Badge status={order.status} /><strong>{money(order.total)}</strong></div>
          </header>
          <div className="bm-order-card__body">
            <OrderReference order={order} compact/><section className="bm-order-payment"><div><span>Payment</span><strong className={`bm-payment-state is-${paymentTone(paymentStatus)}`}>{paymentStatus === 'pending' ? 'Pending Payment' : paymentStatus}</strong></div>
              {paymentStatus === 'Unpaid' && <p>Full payment is required before production can begin.</p>}
              {paymentStatus === 'For Verification' && <p>Your proof is awaiting manual review by BM Printing Services.</p>}
              {paymentStatus === 'Verified' && <p>Your full payment has been manually verified.</p>}
              {paymentStatus === 'Rejected' && <p>{order.paymentRejectionReason || 'Please review the payment details and submit valid proof again.'}</p>}
            </section>
            {specs.length > 0 && <section className="bm-order-specifications"><h3>Product Specifications</h3><dl>{specs.map((row, index) => <div key={`${row.label}-${index}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></section>}
            <ProductionProgress production={order.production} orderStatus={order.status} pickedUpAt={order.pickedUpAt} />
            {order.status === 'Picked Up' && order.pickedUpAt && <p className="bm-order-pickup">Picked up on {new Date(order.pickedUpAt).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })}</p>}
            <OrderDesignFiles order={order} user={user} />
          </div>
          <footer className="bm-order-card__actions">
            <div>{order.status === 'Ready for Pickup' && <strong>Your order is ready for pickup.</strong>}{order.status === 'Cancelled' && <strong>This order was cancelled.</strong>}</div>
            <div>{order.status === 'Completed' && <Btn size="sm" variant="ghost" onClick={() => setReviewModal(order)}>Write a Review</Btn>}
              {order.payment !== 'cash' && !['Verified', 'For Verification'].includes(paymentStatus) && !['Cancelled', 'Completed'].includes(order.status) && <Btn size="sm" onClick={() => setPaymentOrder(order)}>Submit Payment</Btn>}</div>
          </footer>
        </article>;
      })}</div>}

    {user?.role === 'customer' && <section id="my-inquiries" className="bm-customer-inquiries" aria-labelledby="bm-inquiries-title">
      <header><div><span>Support conversations</span><h2 id="bm-inquiries-title">My Inquiries</h2><p>Read and reply to messages you submitted through Contact Us.</p></div></header>
      {inquiryLoading ? <p role="status">Loading your inquiries…</p> : inquiryError && !inquiries.length ? <p role="alert" className="is-error">{inquiryError}</p> : !inquiries.length ? <p className="bm-inquiry-empty-state">No inquiries yet. <button type="button" onClick={() => setPage('contact')}>Contact Us</button> to start a conversation.</p> : <div className="bm-customer-inquiry-list">
        <nav aria-label="Your inquiries">{inquiries.map(item => <button key={item.id} type="button" className={item.id === selectedInquiryId ? 'is-selected' : ''} onClick={() => { setSelectedInquiryId(item.id); setInquiryError(''); setInquiryReply(''); setInquiryRequestId(''); }}><strong>{item.subject}</strong><span>{item.status.replaceAll('_', ' ')}</span><small>{new Date(item.lastActivityAt || item.createdAt).toLocaleString('en-PH')}</small></button>)}</nav>
        {selectedInquiry ? <article className="bm-customer-inquiry-thread"><header><div><h3>{selectedInquiry.subject}</h3><span className="bm-customer-inquiry-status">{selectedInquiry.status.replaceAll('_', ' ')}</span></div></header>
          <div className="bm-customer-inquiry-message"><strong>You · {new Date(selectedInquiry.createdAt).toLocaleString('en-PH')}</strong><p>{selectedInquiry.message}</p></div>
          {(selectedInquiry.replies || []).map(reply => <div className="bm-customer-inquiry-message bm-customer-inquiry-message--staff" key={reply.replyId}><strong>{reply.authorName} · {reply.authorRole === 'admin' ? 'Admin' : 'Staff'} · {new Date(reply.createdAt).toLocaleString('en-PH')}</strong><p>{reply.message}</p></div>)}
          <label>Reply<textarea rows={3} maxLength={3000} value={inquiryReply} onChange={event => setInquiryReply(event.target.value)} placeholder="Write a follow-up message" /></label>
          <Btn disabled={inquirySending || !inquiryReply.trim()} loading={inquirySending} onClick={sendInquiryReply}>Send Reply</Btn>
        </article> : <p className="bm-inquiry-empty-state">Select an inquiry to view its conversation.</p>}
      </div>}
      {inquiryError && inquiries.length > 0 && <p role="alert" className="is-error">{inquiryError}</p>}
    </section>}

    {paymentOrder && <PaymentSubmissionModal order={paymentOrder} user={user} onClose={() => setPaymentOrder(null)} onSubmitted={handlePaymentSubmitted} showToast={showToast} />}
    <Modal open={Boolean(reviewModal)} onClose={() => setReviewModal(null)} title={`Review: ${reviewModal?.product || ''}`}>
      <div className="bm-review-form"><label>Rating</label><div className="bm-review-stars">{[1,2,3,4,5].map(number => <button type="button" aria-label={`${number} stars`} key={number} onClick={() => setReview(value => ({ ...value, rating: number }))} className={number <= review.rating ? 'is-selected' : ''}>★</button>)}</div>
        <Input label="Your Review" type="textarea" value={review.comment} onChange={comment => setReview(value => ({ ...value, comment }))} placeholder="Share your experience with this product..." rows={4}/>
        <Btn onClick={submitReview} loading={submittingReview}>Submit Review</Btn></div>
    </Modal>
  </main>;
};
