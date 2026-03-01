#!/usr/bin/luajit

------------------
--  Environment --
------------------
local DB_HOST = os.getenv('DB_HOST')
local DB_NAME = os.getenv('DB_NAME')
local DB_USER = os.getenv('DB_USER')
local DB_PASS = os.getenv('DB_PASS')
local DB_PORT = os.getenv('DB_PORT')

local DISCARD_SPAM = os.getenv("DISCARD_SPAM")
local RTL_DEVICE_SERIAL = os.getenv("RTL_DEVICE_SERIAL")
local RTL_DEVICE_INDEX = os.getenv("RTL_DEVICE_INDEX")

--------------------------
--  RTL-SDR Device Selection --
--------------------------
local ffi = require('ffi')

ffi.cdef[[
    uint32_t rtlsdr_get_device_count(void);
    int rtlsdr_get_device_usb_strings(uint32_t index, char *manufact, char *product, char *serial);
]]

local rtlsdr_ok, librtlsdr = pcall(ffi.load, "rtlsdr")

function find_device_by_serial (target_serial)
    if not rtlsdr_ok then
        print('Warning: Could not load librtlsdr for device enumeration.')
        return nil
    end

    local count = librtlsdr.rtlsdr_get_device_count()
    print(string.format('Found %d RTL-SDR device(s):', count))

    for i = 0, count - 1 do
        local manufact = ffi.new('char[256]')
        local product = ffi.new('char[256]')
        local serial = ffi.new('char[256]')
        local ret = librtlsdr.rtlsdr_get_device_usb_strings(i, manufact, product, serial)
        if ret == 0 then
            local serial_str = ffi.string(serial)
            print(string.format('  Device %d: %s %s (serial: %q)', i,
                ffi.string(manufact), ffi.string(product), serial_str))
            if serial_str == target_serial then
                return i
            end
        end
    end

    return nil
end

function select_device_index ()
    if RTL_DEVICE_SERIAL ~= nil then
        local idx = find_device_by_serial(RTL_DEVICE_SERIAL)
        if idx ~= nil then
            print(string.format('Selected RTL-SDR device %d by serial %q.', idx, RTL_DEVICE_SERIAL))
            return idx
        else
            print(string.format('ERROR: No RTL-SDR device found with serial %q.', RTL_DEVICE_SERIAL))
            os.exit(1)
        end
    elseif RTL_DEVICE_INDEX ~= nil then
        local idx = tonumber(RTL_DEVICE_INDEX) or 0
        print(string.format('Using RTL-SDR device index %d (from RTL_DEVICE_INDEX).', idx))
        return idx
    else
        print('No RTL_DEVICE_SERIAL or RTL_DEVICE_INDEX set, using device 0.')
        return 0
    end
end

----------------
--  Database  --
----------------
local pgmoon = require ('pgmoon')


-- Note: Each radio block runs in its own process, so we can't share a single
--       database connection. For now, re-open/close the database for each new
--       page. To improve this perhaps have each instance of the DBSink block
--       store its own database connection.
--       Note: This will mean we need a destructor for the DBSink block.

function get_db ()
    local pg = pgmoon.new ({
        host = DB_HOST,
        port = DB_PORT,
        database = DB_NAME,
        user = DB_USER,
        password = DB_PASS,
    })

    local ok, err = pg:connect ()
    if not ok then
        return nil, err
    end
    return pg
end

-- Create the table if it doesn't already exist
function create_database ()
    local pg, err = get_db ()
    if not pg then
        print ('Error connecting to database.')
        print (err)
        return false
    end

    print ('Connected to database.')

    print ('Attempting to create table...')
    local res, err = pg:query [[
        CREATE TABLE IF NOT EXISTS pages (
            rx_date     timestamp   not null,
            source      text        not null,
            recipient   text        not null,
            content     text        not null);
    ]]

    if not res then
        print ('Error creating table.')
        print (err)
        pg:disconnect ()
        return false
    end
    print ('...table okay.')

    print ('Attempting to create id column...')
    res, err = pg:query [[
        ALTER TABLE pages
        ADD COLUMN IF NOT EXISTS id integer
        GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
    ]]

    if not res then
        print ('Error creating id column.')
        print (err)
        pg:disconnect ()
        return false
    end
    print ('...id column okay.')

    print ('Attempting to create search index column...')
    res, err = pg:query [[
        ALTER TABLE pages
        ADD COLUMN IF NOT EXISTS tsx tsvector
        GENERATED ALWAYS AS (to_tsvector('simple', recipient || ' ' || content)) STORED;
    ]]

    if not res then
        print ('Error creating search index column.')
        print (err)
        pg:disconnect ()
        return false
    end
    print ('...search index column okay.')

    print ('Attempting to create search index...')
    res, err = pg:query [[
        CREATE INDEX IF NOT EXISTS search_idx ON pages USING GIN (tsx);
    ]]

    if not res then
        print ('Error creating search index.')
        print (err)
        pg:disconnect ()
        return false
    end
    print ('...search index okay.')

    pg:disconnect ()
    return true
end

function is_spam (content)
    local text_lower = string.lower(content)
    if string.len(text_lower) < 4 then
        -- very short messages
        return true
    elseif string.find(text_lower, "ha/modica") or string.find(text_lower, "this is a test periodic") then
        -- test messages
        return true
    else
        return false
    end
end

-- Store a page in the database
function store_page (date, source, address, content)
    if (DISCARD_SPAM == 'true') and is_spam(content) then
        return
    end

    local pg, err = get_db ()
    if not pg then
        print ('Error connecting to database: ' .. (err or 'unknown'))
        return
    end

    local res, err = pg:query (string.format (
        "INSERT INTO pages (rx_date, source, recipient, content) VALUES (%s, %s, %s, %s)",
        pg:escape_literal (date),
        pg:escape_literal (source),
        pg:escape_literal (address),
        pg:escape_literal (content)
    ))

    if not res then
        print ('Error inserting page: ' .. (err or 'unknown'))
    end

    pg:disconnect ()
end


------------
--  Sink  --
------------
local radio = require ('radio')
local DBSink = radio.block.factory ('DBSink')

function DBSink:instantiate (name)
    -- Type signature
    self:add_type_signature ( { radio.block.Input ('in', function (type) return type.to_json ~= nil end) }, {} )

    self.name = name
end

function clean_string (s_dirty)
    local chars = {}

    for i = 1, #s_dirty do
        local c = s_dirty:sub (i, i)
        if c:byte () >= 32 and c:byte () < 127 then
            chars[#chars + 1] = c
        end
    end

    return table.concat (chars)
end

function DBSink:process (x)
    local date = os.date ('%F %T')

    for i = 0, x.length-1 do

        -- First, check for an alphanumeric page
        if x.data[i].alphanumeric ~= nil then
            local content = clean_string (x.data[i].alphanumeric)
            print ('[' .. date .. '] ' .. self.name .. ': ' .. content)
            store_page (date, self.name, tostring(x.data[i].address), content)

        -- Failing that, fall back to a numeric page
        elseif x.data[i].numeric ~= nil then
            local content = clean_string (x.data[i].numeric)
            print ('[' .. date .. '] ' .. self.name .. ': ' .. content)
            store_page (date, self.name, tostring(x.data[i].address), content)

        end
    end
end


----------------
--  Receiver  --
----------------
local PokeSAG = radio.CompositeBlock ()

-- Select the correct RTL-SDR device
local device_index = select_device_index ()

-- Receiver frequency: 157.900 MHz
local source = radio.RtlSdrSource (157900000, 1000000, {device_index = device_index})

-- Spark: 157.925 MHz
local spark925_tuner   = radio.TunerBlock (-25000, 12e3, 80)
local spark925_decoder = radio.POCSAGReceiver (1200)
local spark925_sink    = DBSink ('Spark 925')
PokeSAG:connect (source, spark925_tuner, spark925_decoder, spark925_sink)

-- Spark: 157.950 MHz
local spark950_tuner   = radio.TunerBlock (-50000, 12e3, 80)
local spark950_decoder = radio.POCSAGReceiver (1200)
local spark950_sink    = DBSink ('Spark 950')
PokeSAG:connect (source, spark950_tuner, spark950_decoder, spark950_sink)

-- Hospital: 157.975 MHz
local hospital_tuner     = radio.TunerBlock (-75000, 12e3, 80)
local hospital_decoder   = radio.POCSAGReceiver (512)
local hospital_sink      = DBSink ('Ambulance')
PokeSAG:connect (source, hospital_tuner, hospital_decoder, hospital_sink)

if create_database () then
    print ('Starting PokeSAG.')
    PokeSAG:run ()
    print ('PokeSAG Stopped.')
else
    print ('Unable to access database.')
end
