use std::error::Error;
use std::ffi::{CStr, CString, NulError};
use std::fmt;
use std::os::raw::{c_char, c_int, c_uchar, c_void};
use std::path::Path;
use std::ptr;

const SQLITE_OK: c_int = 0;
const SQLITE_ROW: c_int = 100;
const SQLITE_DONE: c_int = 101;
const SQLITE_OPEN_READWRITE: c_int = 0x0000_0002;
const SQLITE_OPEN_CREATE: c_int = 0x0000_0004;
const SQLITE_OPEN_FULLMUTEX: c_int = 0x0001_0000;
const SQLITE_TRANSIENT: *mut c_void = -1_isize as *mut c_void;

#[repr(C)]
struct Sqlite3(c_void);

#[repr(C)]
struct Sqlite3Stmt(c_void);

#[link(name = "sqlite3")]
unsafe extern "C" {
    fn sqlite3_open_v2(
        filename: *const c_char,
        pp_db: *mut *mut Sqlite3,
        flags: c_int,
        z_vfs: *const c_char,
    ) -> c_int;
    fn sqlite3_close(db: *mut Sqlite3) -> c_int;
    fn sqlite3_errmsg(db: *mut Sqlite3) -> *const c_char;
    fn sqlite3_exec(
        db: *mut Sqlite3,
        sql: *const c_char,
        callback: Option<unsafe extern "C" fn()>,
        arg: *mut c_void,
        errmsg: *mut *mut c_char,
    ) -> c_int;
    fn sqlite3_free(ptr: *mut c_void);
    fn sqlite3_prepare_v2(
        db: *mut Sqlite3,
        sql: *const c_char,
        n_byte: c_int,
        pp_stmt: *mut *mut Sqlite3Stmt,
        pz_tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_step(stmt: *mut Sqlite3Stmt) -> c_int;
    fn sqlite3_finalize(stmt: *mut Sqlite3Stmt) -> c_int;
    fn sqlite3_bind_text(
        stmt: *mut Sqlite3Stmt,
        index: c_int,
        value: *const c_char,
        n: c_int,
        destructor: *mut c_void,
    ) -> c_int;
    fn sqlite3_bind_int64(stmt: *mut Sqlite3Stmt, index: c_int, value: i64) -> c_int;
    fn sqlite3_bind_null(stmt: *mut Sqlite3Stmt, index: c_int) -> c_int;
    fn sqlite3_column_count(stmt: *mut Sqlite3Stmt) -> c_int;
    fn sqlite3_column_name(stmt: *mut Sqlite3Stmt, index: c_int) -> *const c_char;
    fn sqlite3_column_text(stmt: *mut Sqlite3Stmt, index: c_int) -> *const c_uchar;
    fn sqlite3_column_int64(stmt: *mut Sqlite3Stmt, index: c_int) -> i64;
    fn sqlite3_column_type(stmt: *mut Sqlite3Stmt, index: c_int) -> c_int;
}

#[derive(Debug)]
pub enum DbError {
    InvalidCString(NulError),
    Sqlite(String),
    InvalidPath(String),
    InvalidColumn(String),
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCString(source) => write!(f, "SQLite string contains NUL byte: {source}"),
            Self::Sqlite(message) => write!(f, "SQLite error: {message}"),
            Self::InvalidPath(path) => write!(f, "database path is not valid UTF-8: {path}"),
            Self::InvalidColumn(column) => write!(f, "missing SQLite column: {column}"),
        }
    }
}

impl Error for DbError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidCString(source) => Some(source),
            _ => None,
        }
    }
}

impl From<NulError> for DbError {
    fn from(value: NulError) -> Self {
        Self::InvalidCString(value)
    }
}

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug, Clone)]
pub enum DbValue {
    Null,
    Integer(i64),
    Text(String),
}

#[derive(Debug, Clone)]
pub struct Row {
    values: Vec<(String, DbValue)>,
}

impl Row {
    pub fn text(&self, name: &str) -> DbResult<String> {
        match self.value(name)? {
            DbValue::Text(value) => Ok(value.clone()),
            DbValue::Integer(value) => Ok(value.to_string()),
            DbValue::Null => Err(DbError::InvalidColumn(name.to_string())),
        }
    }

    pub fn opt_text(&self, name: &str) -> DbResult<Option<String>> {
        match self.value(name)? {
            DbValue::Text(value) => Ok(Some(value.clone())),
            DbValue::Integer(value) => Ok(Some(value.to_string())),
            DbValue::Null => Ok(None),
        }
    }

    pub fn i64(&self, name: &str) -> DbResult<i64> {
        match self.value(name)? {
            DbValue::Integer(value) => Ok(*value),
            DbValue::Text(value) => value
                .parse::<i64>()
                .map_err(|_| DbError::InvalidColumn(name.to_string())),
            DbValue::Null => Err(DbError::InvalidColumn(name.to_string())),
        }
    }

    pub fn opt_i64(&self, name: &str) -> DbResult<Option<i64>> {
        match self.value(name)? {
            DbValue::Integer(value) => Ok(Some(*value)),
            DbValue::Text(value) => value
                .parse::<i64>()
                .map(Some)
                .map_err(|_| DbError::InvalidColumn(name.to_string())),
            DbValue::Null => Ok(None),
        }
    }

    fn value(&self, name: &str) -> DbResult<&DbValue> {
        self.values
            .iter()
            .find(|(column, _)| column == name)
            .map(|(_, value)| value)
            .ok_or_else(|| DbError::InvalidColumn(name.to_string()))
    }
}

pub enum Param<'a> {
    Text(&'a str),
    Integer(i64),
    Null,
}

pub struct Connection {
    raw: *mut Sqlite3,
}

impl Connection {
    pub fn open(path: &Path) -> DbResult<Self> {
        let path_text = path
            .to_str()
            .ok_or_else(|| DbError::InvalidPath(path.display().to_string()))?;
        let c_path = CString::new(path_text)?;
        let mut raw = ptr::null_mut();
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX;

        // SAFETY: sqlite3_open_v2 requires a valid C string and out pointer. Both are provided.
        let rc = unsafe { sqlite3_open_v2(c_path.as_ptr(), &mut raw, flags, ptr::null()) };
        if rc != SQLITE_OK {
            let message = if raw.is_null() {
                format!("failed to open {path_text}")
            } else {
                sqlite_error(raw)
            };
            if !raw.is_null() {
                // SAFETY: raw was returned by sqlite3_open_v2 and is being closed once.
                unsafe {
                    sqlite3_close(raw);
                }
            }
            return Err(DbError::Sqlite(message));
        }

        Ok(Self { raw })
    }

    pub fn execute_batch(&self, sql: &str) -> DbResult<()> {
        let c_sql = CString::new(sql)?;
        let mut errmsg = ptr::null_mut();
        // SAFETY: db handle is valid for self lifetime; SQL is a valid C string; no callback used.
        let rc =
            unsafe { sqlite3_exec(self.raw, c_sql.as_ptr(), None, ptr::null_mut(), &mut errmsg) };
        if rc != SQLITE_OK {
            let message = if errmsg.is_null() {
                sqlite_error(self.raw)
            } else {
                // SAFETY: errmsg is owned by SQLite when non-null and valid until sqlite3_free.
                let message = unsafe { CStr::from_ptr(errmsg).to_string_lossy().into_owned() };
                // SAFETY: errmsg must be released with sqlite3_free.
                unsafe {
                    sqlite3_free(errmsg.cast::<c_void>());
                }
                message
            };
            return Err(DbError::Sqlite(message));
        }
        Ok(())
    }

    pub fn execute(&self, sql: &str, params: &[Param<'_>]) -> DbResult<()> {
        let mut stmt = Statement::prepare(self.raw, sql)?;
        stmt.bind(params)?;
        match stmt.step()? {
            Step::Done => Ok(()),
            Step::Row => Err(DbError::Sqlite(
                "statement returned rows for execute".into(),
            )),
        }
    }

    pub fn query(&self, sql: &str, params: &[Param<'_>]) -> DbResult<Vec<Row>> {
        let mut stmt = Statement::prepare(self.raw, sql)?;
        stmt.bind(params)?;
        let mut rows = Vec::new();
        loop {
            match stmt.step()? {
                Step::Done => break,
                Step::Row => rows.push(stmt.row()?),
            }
        }
        Ok(rows)
    }

    pub fn query_one(&self, sql: &str, params: &[Param<'_>]) -> DbResult<Option<Row>> {
        let mut rows = self.query(sql, params)?;
        Ok(rows.drain(..).next())
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            // SAFETY: self.raw is owned by this connection and closed once in Drop.
            unsafe {
                sqlite3_close(self.raw);
            }
        }
    }
}

enum Step {
    Row,
    Done,
}

struct Statement {
    db: *mut Sqlite3,
    raw: *mut Sqlite3Stmt,
}

impl Statement {
    fn prepare(db: *mut Sqlite3, sql: &str) -> DbResult<Self> {
        let c_sql = CString::new(sql)?;
        let mut raw = ptr::null_mut();
        // SAFETY: db handle and SQL pointer are valid; SQLite initializes raw statement pointer.
        let rc = unsafe { sqlite3_prepare_v2(db, c_sql.as_ptr(), -1, &mut raw, ptr::null_mut()) };
        if rc != SQLITE_OK {
            return Err(DbError::Sqlite(sqlite_error(db)));
        }
        Ok(Self { db, raw })
    }

    fn bind(&mut self, params: &[Param<'_>]) -> DbResult<()> {
        for (idx, param) in params.iter().enumerate() {
            let index = c_int::try_from(idx + 1)
                .map_err(|_| DbError::Sqlite("too many SQLite parameters".into()))?;
            let rc = match param {
                Param::Text(value) => {
                    let c_value = CString::new(*value)?;
                    // SAFETY: SQLite copies the text because SQLITE_TRANSIENT is used.
                    unsafe {
                        sqlite3_bind_text(self.raw, index, c_value.as_ptr(), -1, SQLITE_TRANSIENT)
                    }
                }
                Param::Integer(value) => {
                    // SAFETY: statement is valid and index is 1-based.
                    unsafe { sqlite3_bind_int64(self.raw, index, *value) }
                }
                Param::Null => {
                    // SAFETY: statement is valid and index is 1-based.
                    unsafe { sqlite3_bind_null(self.raw, index) }
                }
            };
            if rc != SQLITE_OK {
                return Err(DbError::Sqlite(sqlite_error(self.db)));
            }
        }
        Ok(())
    }

    fn step(&mut self) -> DbResult<Step> {
        // SAFETY: statement is valid while self is alive.
        match unsafe { sqlite3_step(self.raw) } {
            SQLITE_ROW => Ok(Step::Row),
            SQLITE_DONE => Ok(Step::Done),
            _ => Err(DbError::Sqlite(sqlite_error(self.db))),
        }
    }

    fn row(&self) -> DbResult<Row> {
        // SAFETY: statement is valid and currently positioned on a row.
        let count = unsafe { sqlite3_column_count(self.raw) };
        let mut values = Vec::new();
        for index in 0..count {
            // SAFETY: column name pointer is valid for prepared statement lifetime.
            let name_ptr = unsafe { sqlite3_column_name(self.raw, index) };
            if name_ptr.is_null() {
                return Err(DbError::InvalidColumn(index.to_string()));
            }
            // SAFETY: SQLite returned a non-null column-name C string.
            let name = unsafe { CStr::from_ptr(name_ptr).to_string_lossy().into_owned() };
            // SAFETY: column type and value access are valid on current row.
            let column_type = unsafe { sqlite3_column_type(self.raw, index) };
            let value = match column_type {
                1 => {
                    // SAFETY: integer access is valid for current row.
                    DbValue::Integer(unsafe { sqlite3_column_int64(self.raw, index) })
                }
                3 => {
                    // SAFETY: text pointer is valid until next step/finalize and is copied immediately.
                    let text_ptr = unsafe { sqlite3_column_text(self.raw, index) };
                    if text_ptr.is_null() {
                        DbValue::Null
                    } else {
                        // SAFETY: SQLite text is NUL-terminated for sqlite3_column_text.
                        let text = unsafe {
                            CStr::from_ptr(text_ptr.cast::<c_char>())
                                .to_string_lossy()
                                .into_owned()
                        };
                        DbValue::Text(text)
                    }
                }
                _ => DbValue::Null,
            };
            values.push((name, value));
        }
        Ok(Row { values })
    }
}

impl Drop for Statement {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            // SAFETY: self.raw is owned by this statement and finalized once in Drop.
            unsafe {
                sqlite3_finalize(self.raw);
            }
        }
    }
}

fn sqlite_error(db: *mut Sqlite3) -> String {
    if db.is_null() {
        return "unknown SQLite error".into();
    }
    // SAFETY: db is a SQLite handle; errmsg pointer is valid and static until next SQLite call.
    let ptr = unsafe { sqlite3_errmsg(db) };
    if ptr.is_null() {
        "unknown SQLite error".into()
    } else {
        // SAFETY: sqlite3_errmsg returns a valid C string.
        unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() }
    }
}
