import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireStaff } from './auth.jsx';
import Launcher from './Launcher.jsx';
import Login from './Login.jsx';
import { Spinner } from './ui.jsx';

const ReceptionShell = lazy(() => import('./reception/Shell.jsx'));
const Calendar = lazy(() => import('./reception/Calendar.jsx'));
const NewAppointment = lazy(() => import('./reception/NewAppointment.jsx'));
const EditAppointment = lazy(() => import('./reception/EditAppointment.jsx'));
const CheckIn = lazy(() => import('./reception/CheckIn.jsx'));
const Billing = lazy(() => import('./reception/Billing.jsx'));
const Invoice = lazy(() => import('./reception/Invoice.jsx'));
const Clients = lazy(() => import('./reception/Clients.jsx'));
const ClientProfile = lazy(() => import('./reception/ClientProfile.jsx'));
const Services = lazy(() => import('./reception/Services.jsx'));
const ServiceEdit = lazy(() => import('./reception/ServiceEdit.jsx'));
const Analytics = lazy(() => import('./reception/Analytics.jsx'));
const StaffShell = lazy(() => import('./staff/StaffShell.jsx'));
const MyDay = lazy(() => import('./staff/MyDay.jsx'));
const Consultation = lazy(() => import('./staff/Consultation.jsx'));
const ClientApp = lazy(() => import('./client/ClientApp.jsx'));
const Book = lazy(() => import('./client/Book.jsx'));
const Sent = lazy(() => import('./client/Sent.jsx'));
const MyAppointments = lazy(() => import('./client/MyAppointments.jsx'));
const PayInvoice = lazy(() => import('./client/PayInvoice.jsx'));
const SelfCheckIn = lazy(() => import('./client/SelfCheckIn.jsx'));
const OfferPage = lazy(() => import('./client/OfferPage.jsx'));

export default function App() {
  return (
    <Suspense fallback={<div className="center-page"><Spinner /></div>}>
      <Routes>
        <Route path="/" element={<Launcher />} />
        <Route path="/login" element={<Login />} />

        <Route path="/reception" element={<RequireStaff roles={['reception']} app="reception"><ReceptionShell /></RequireStaff>}>
          <Route index element={<Navigate to="calendar" replace />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="appointments/new" element={<NewAppointment />} />
          <Route path="appointments/:id" element={<EditAppointment />} />
          <Route path="checkin" element={<CheckIn />} />
          <Route path="billing" element={<Billing />} />
          <Route path="billing/:id" element={<Invoice />} />
          <Route path="billing/visit/:apptId" element={<Invoice byAppointment />} />
          <Route path="clients" element={<Clients />} />
          <Route path="clients/:id" element={<ClientProfile />} />
          <Route path="services" element={<Services />} />
          <Route path="services/:id" element={<ServiceEdit />} />
          <Route path="analytics" element={<Analytics />} />
        </Route>

        <Route path="/staff" element={<RequireStaff app="staff"><StaffShell /></RequireStaff>}>
          <Route index element={<MyDay />} />
          <Route path="consultation" element={<Consultation />} />
          <Route path="consultation/:apptId" element={<Consultation />} />
        </Route>

        <Route element={<ClientApp />}>
          <Route path="/book" element={<Book />} />
          <Route path="/book/sent" element={<Sent />} />
          <Route path="/my" element={<MyAppointments />} />
          <Route path="/pay/:id" element={<PayInvoice />} />
          <Route path="/checkin" element={<SelfCheckIn />} />
          <Route path="/offer/:token" element={<OfferPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
