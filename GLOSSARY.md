# YOi Spa booking

Booking spa treatments across several branches, by customers online, by staff on the dashboard, and by staff through the AI assistant.

## Language

**Booking**:
One guest's appointment: one guest, one therapist, one bed, one time slot at one branch.
_Avoid_: lịch nhóm (for a single guest's appointment), group booking

**Group**:
The Bookings of guests who were booked together (for example 2–3 friends). Each guest in a Group still has their own Booking, and stays in the Group even when moved, checked in or cancelled separately.
_Avoid_: group booking, nhóm lịch

**Contact**:
The person a Group is booked under (name, phone, customer profile), e.g. "Miss Mia". Every guest in the Group carries the Contact unless given their own name; the others are shown as "Friend of Miss Mia".
_Avoid_: lead guest, main customer, khách chính

## Staff

**Home branch**:
The one branch a therapist belongs to at a time. A therapist works at a branch on a given day only if it is their Home branch and they have a shift that day.
_Avoid_: "works at" for a branch the therapist is only covering for a day

## Opening hours

**Last booking time**:
The latest time a treatment may start at a branch on a given day. Treatments may run past it.
_Avoid_: closing time, giờ đóng cửa (when the latest start time is meant)

**Closing time**:
When the branch closes: either a fixed time that every treatment must end by, or "after last service", where the branch stays open until the last treatment of the day finishes.
_Avoid_: last booking time

**Late arrival grace**:
How many minutes after the Last booking time a guest booked at that time may still be checked in without a warning.
_Avoid_: buffer (buffer is the rest time between two guests of one therapist)
