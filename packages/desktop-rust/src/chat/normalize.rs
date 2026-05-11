use crate::protocol::{NormalizedChatMessage, NormalizedEvent};
use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq)]
pub enum NormalizedChatItem {
    Message(NormalizedChatMessage),
    Event(NormalizedEvent),
}

pub fn normalize_message(message: NormalizedChatMessage) -> NormalizedChatMessage {
    message
}

pub fn normalize_event(event: NormalizedEvent) -> NormalizedEvent {
    event
}

pub fn message_timestamp_millis(message: &NormalizedChatMessage) -> i128 {
    timestamp_millis(&message.timestamp)
}

pub(crate) fn compare_message_keys(
    left: &NormalizedChatMessage,
    right: &NormalizedChatMessage,
) -> Ordering {
    timestamp_millis(&left.timestamp)
        .cmp(&timestamp_millis(&right.timestamp))
        .then_with(|| left.id.cmp(&right.id))
}

fn timestamp_millis(timestamp: &str) -> i128 {
    let trimmed = timestamp.trim();
    if let Ok(value) = trimmed.parse::<i128>() {
        return value;
    }

    iso_utc_timestamp_millis(trimmed).unwrap_or_else(|| stable_string_order_key(trimmed))
}

fn stable_string_order_key(value: &str) -> i128 {
    value
        .bytes()
        .take(16)
        .fold(0_i128, |acc, byte| (acc << 8) + i128::from(byte))
}

fn iso_utc_timestamp_millis(value: &str) -> Option<i128> {
    let (date, time) = value.split_once('T')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = date_parts.next()?.parse::<u32>().ok()?;
    let day = date_parts.next()?.parse::<u32>().ok()?;

    let time = time.trim_end_matches('Z');
    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<u32>().ok()?;
    let minute = time_parts.next()?.parse::<u32>().ok()?;
    let seconds_part = time_parts.next()?;
    let (second_text, millis) = seconds_part
        .split_once('.')
        .map_or((seconds_part, 0_i128), |(seconds, fraction)| {
            (seconds, parse_millis_fraction(fraction))
        });
    let second = second_text.parse::<u32>().ok()?;

    if !(1..=12).contains(&month) || day == 0 || hour > 23 || minute > 59 || second > 60 {
        return None;
    }

    let days = days_from_civil(year, month, day)?;
    Some(
        (((days * 24 + i128::from(hour)) * 60 + i128::from(minute)) * 60 + i128::from(second))
            * 1000
            + millis,
    )
}

fn parse_millis_fraction(fraction: &str) -> i128 {
    let mut millis = 0_i128;
    let mut factor = 100_i128;
    for digit in fraction.chars().take(3) {
        let Some(value) = digit.to_digit(10) else {
            break;
        };
        millis += i128::from(value) * factor;
        factor /= 10;
    }
    millis
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i128> {
    let month_days = days_in_month(year, month)?;
    if day > month_days {
        return None;
    }

    let adjusted_year = year - i32::from(month <= 2);
    let era = if adjusted_year >= 0 {
        adjusted_year
    } else {
        adjusted_year - 399
    } / 400;
    let year_of_era = adjusted_year - era * 400;
    let month = i32::try_from(month).ok()?;
    let day = i32::try_from(day).ok()?;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(i128::from(era) * 146_097 + i128::from(day_of_era) - 719_468)
}

fn days_in_month(year: i32, month: u32) -> Option<u32> {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Some(31),
        4 | 6 | 9 | 11 => Some(30),
        2 if is_leap_year(year) => Some(29),
        2 => Some(28),
        _ => None,
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}
