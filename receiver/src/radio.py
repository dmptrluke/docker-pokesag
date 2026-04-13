"""GNURadio flowgraph: one RTL-SDR source fanned out to N FM-demod
chains, each writing audio into a multimon-ng stdin fd."""

import logging

import osmosdr
from gnuradio import analog, blocks, fft, gr
from gnuradio import filter as gr_filter
from gnuradio.filter import firdes

import config

log = logging.getLogger('pokesag')


class PagerFlowgraph(gr.top_block):
    """GNURadio top_block that captures from one RTL-SDR and splits
    into parallel FM-demod + multimon-ng output chains.

    RTL-SDR (1 MHz) -> for each channel:
        freq_xlating_fir_filter (shift + LPF + decimate -> 50 kHz)
        -> quadrature_demod (FM discriminator)
        -> rational_resampler (50 kHz -> 22050 Hz)
        -> float_to_short (scale to int16)
        -> file_descriptor_sink (write to multimon-ng stdin)
    """

    def __init__(self, channel_fds):
        gr.top_block.__init__(self, 'PokeSAG Receiver')

        args = f'rtl={config.RTL_DEVICE_SERIAL}' if config.RTL_DEVICE_SERIAL else 'rtl=0'

        log.info('Opening RTL-SDR: args=%s', args)
        self.src = osmosdr.source(args=args)
        self.src.set_sample_rate(config.SAMPLE_RATE)
        self.src.set_center_freq(config.CENTER_FREQ)
        self.src.set_gain_mode(True, 0)  # AGC
        self.src.set_if_gain(20, 0)
        self.src.set_bb_gain(20, 0)
        log.info(
            'SDR configured: %.3f MHz centre, %d Hz bandwidth, AGC on',
            config.CENTER_FREQ / 1e6,
            config.SAMPLE_RATE,
        )

        for cfg, fd in zip(config.CHANNELS, channel_fds, strict=True):
            name = cfg['name']
            offset = cfg['offset_hz']

            taps = firdes.low_pass(
                1.0,
                config.SAMPLE_RATE,
                config.CHANNEL_BW,
                config.TRANSITION_W,
                fft.window.WIN_HAMMING,
            )

            xlat = gr_filter.freq_xlating_fir_filter_ccf(
                config.DECIMATION_IQ,
                taps,
                offset,
                config.SAMPLE_RATE,
            )

            quad = analog.quadrature_demod_cf(config.DEMOD_GAIN)

            resamp = gr_filter.rational_resampler_fff(
                interpolation=config.RESAMPLE_UP,
                decimation=config.RESAMPLE_DOWN,
            )

            f2s = blocks.float_to_short(1, config.AUDIO_SCALE)

            sink = blocks.file_descriptor_sink(gr.sizeof_short, fd)

            self.connect(self.src, xlat, quad, resamp, f2s, sink)

            log.info(
                "Channel '%s': %.3f MHz (offset %+d Hz), fd=%d, demod_gain=%.3f, scale=%.0f",
                name,
                (config.CENTER_FREQ + offset) / 1e6,
                offset,
                fd,
                config.DEMOD_GAIN,
                config.AUDIO_SCALE,
            )
