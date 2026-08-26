//! 40 个常用 `Nt*` 的间接 syscall 封装。
//!
//! 每个封装对应 `stub.rs` 里的一个汇编桥。参数统一以 `usize` 传递句柄/指针，
//! 返回 `NtStatus`。调用前必须先 `crate::init()`，否则对应 SSN 槽为 0。

#![allow(dead_code)]

use crate::types::{Boolean, Handle, LargeInteger, NtStatus};

extern "C" {
    fn libra_nt_close(handle: Handle) -> NtStatus;
    fn libra_nt_open_process(
        process_handle: usize,
        desired_access: u32,
        object_attributes: usize,
        client_id: usize,
    ) -> NtStatus;
    fn libra_nt_open_thread(
        thread_handle: usize,
        desired_access: u32,
        object_attributes: usize,
        client_id: usize,
    ) -> NtStatus;
    fn libra_nt_open_process_token(
        process_handle: Handle,
        desired_access: u32,
        token_handle: usize,
    ) -> NtStatus;
    fn libra_nt_open_thread_token(
        thread_handle: Handle,
        desired_access: u32,
        open_as_self: Boolean,
        token_handle: usize,
    ) -> NtStatus;
    fn libra_nt_terminate_process(process_handle: Handle, exit_status: NtStatus) -> NtStatus;
    fn libra_nt_terminate_thread(thread_handle: Handle, exit_status: NtStatus) -> NtStatus;
    fn libra_nt_suspend_thread(thread_handle: Handle, previous_suspend_count: usize) -> NtStatus;
    fn libra_nt_resume_thread(thread_handle: Handle, previous_suspend_count: usize) -> NtStatus;
    fn libra_nt_alert_resume_thread(
        thread_handle: Handle,
        previous_suspend_count: usize,
    ) -> NtStatus;
    fn libra_nt_get_context_thread(thread_handle: Handle, context: usize) -> NtStatus;
    fn libra_nt_set_context_thread(thread_handle: Handle, context: usize) -> NtStatus;
    fn libra_nt_query_information_process(
        process_handle: Handle,
        class: u32,
        info: usize,
        len: u32,
        ret_len: usize,
    ) -> NtStatus;
    fn libra_nt_query_information_thread(
        thread_handle: Handle,
        class: u32,
        info: usize,
        len: u32,
        ret_len: usize,
    ) -> NtStatus;
    fn libra_nt_query_information_token(
        token_handle: Handle,
        class: u32,
        info: usize,
        len: u32,
        ret_len: usize,
    ) -> NtStatus;
    fn libra_nt_query_system_information(
        class: u32,
        info: usize,
        len: u32,
        ret_len: usize,
    ) -> NtStatus;
    fn libra_nt_query_object(
        handle: Handle,
        class: u32,
        info: usize,
        len: u32,
        ret_len: usize,
    ) -> NtStatus;
    fn libra_nt_query_virtual_memory(
        process_handle: Handle,
        base: usize,
        class: u32,
        info: usize,
        len: usize,
        ret_len: usize,
    ) -> NtStatus;
    fn libra_nt_allocate_virtual_memory(
        process_handle: Handle,
        base: usize,
        zero_bits: usize,
        region_size: usize,
        alloc_type: u32,
        protect: u32,
    ) -> NtStatus;
    fn libra_nt_free_virtual_memory(
        process_handle: Handle,
        base: usize,
        region_size: usize,
        free_type: u32,
    ) -> NtStatus;
    fn libra_nt_protect_virtual_memory(
        process_handle: Handle,
        base: usize,
        region_size: usize,
        new_protect: u32,
        old_protect: usize,
    ) -> NtStatus;
    fn libra_nt_write_virtual_memory(
        process_handle: Handle,
        base: usize,
        buffer: usize,
        len: usize,
        bytes_written: usize,
    ) -> NtStatus;
    fn libra_nt_read_virtual_memory(
        process_handle: Handle,
        base: usize,
        buffer: usize,
        len: usize,
        bytes_read: usize,
    ) -> NtStatus;
    fn libra_nt_unmap_view_of_section(process_handle: Handle, base: usize) -> NtStatus;
    fn libra_nt_map_view_of_section(
        section_handle: Handle,
        process_handle: Handle,
        base: usize,
        zero_bits: usize,
        commit_size: usize,
        section_offset: usize,
        view_size: usize,
        inherit: u32,
        alloc_type: u32,
        protect: u32,
    ) -> NtStatus;
    fn libra_nt_create_section(
        section_handle: usize,
        desired_access: u32,
        object_attributes: usize,
        max_size: usize,
        page_protect: u32,
        alloc_attributes: u32,
        file_handle: Handle,
    ) -> NtStatus;
    fn libra_nt_open_section(
        section_handle: usize,
        desired_access: u32,
        object_attributes: usize,
    ) -> NtStatus;
    fn libra_nt_create_event(
        event_handle: usize,
        desired_access: u32,
        object_attributes: usize,
        event_type: u32,
        initial_state: Boolean,
    ) -> NtStatus;
    fn libra_nt_set_event(event_handle: Handle, previous_state: usize) -> NtStatus;
    fn libra_nt_wait_for_single_object(
        handle: Handle,
        alertable: Boolean,
        timeout: usize,
    ) -> NtStatus;
    fn libra_nt_signal_and_wait_for_single_object(
        signal_handle: Handle,
        wait_handle: Handle,
        alertable: Boolean,
        timeout: usize,
    ) -> NtStatus;
    fn libra_nt_create_thread_ex(
        thread_handle: usize,
        desired_access: u32,
        object_attributes: usize,
        process_handle: Handle,
        start_routine: usize,
        argument: usize,
        create_flags: u32,
        zero_bits: usize,
        stack_size: usize,
        max_stack_size: usize,
        attribute_list: usize,
    ) -> NtStatus;
    fn libra_nt_queue_apc_thread(
        thread_handle: Handle,
        apc_routine: usize,
        arg1: usize,
        arg2: usize,
        arg3: usize,
    ) -> NtStatus;
    fn libra_nt_duplicate_object(
        source_process: Handle,
        source_handle: Handle,
        target_process: Handle,
        target_handle: usize,
        desired_access: u32,
        handle_attributes: u32,
        options: u32,
    ) -> NtStatus;
    fn libra_nt_duplicate_token(
        existing_token: Handle,
        desired_access: u32,
        object_attributes: usize,
        effective_only: Boolean,
        token_type: u32,
        new_token: usize,
    ) -> NtStatus;
    fn libra_nt_set_information_thread(
        thread_handle: Handle,
        class: u32,
        info: usize,
        len: usize,
    ) -> NtStatus;
    fn libra_nt_set_information_process(
        process_handle: Handle,
        class: u32,
        info: usize,
        len: usize,
    ) -> NtStatus;
    fn libra_nt_set_information_virtual_memory(
        process_handle: Handle,
        class: u32,
        num_entries: usize,
        entries: usize,
        buffer: usize,
        buffer_len: usize,
    ) -> NtStatus;
    fn libra_nt_get_next_thread(
        process_handle: Handle,
        thread_handle: Handle,
        desired_access: u32,
        handle_attributes: u32,
        flags: u32,
        new_thread_handle: usize,
    ) -> NtStatus;
    fn libra_nt_delay_execution(alertable: Boolean, interval: *mut LargeInteger) -> NtStatus;
}

#[inline(always)]
pub unsafe fn nt_close(handle: Handle) -> NtStatus {
    libra_nt_close(handle)
}

#[inline(always)]
pub unsafe fn nt_open_process(
    process_handle: *mut Handle,
    desired_access: u32,
    object_attributes: usize,
    client_id: usize,
) -> NtStatus {
    libra_nt_open_process(
        process_handle as usize,
        desired_access,
        object_attributes,
        client_id,
    )
}

#[inline(always)]
pub unsafe fn nt_open_thread(
    thread_handle: *mut Handle,
    desired_access: u32,
    object_attributes: usize,
    client_id: usize,
) -> NtStatus {
    libra_nt_open_thread(
        thread_handle as usize,
        desired_access,
        object_attributes,
        client_id,
    )
}

#[inline(always)]
pub unsafe fn nt_open_process_token(
    process_handle: Handle,
    desired_access: u32,
    token_handle: *mut Handle,
) -> NtStatus {
    libra_nt_open_process_token(process_handle, desired_access, token_handle as usize)
}

#[inline(always)]
pub unsafe fn nt_open_thread_token(
    thread_handle: Handle,
    desired_access: u32,
    open_as_self: Boolean,
    token_handle: *mut Handle,
) -> NtStatus {
    libra_nt_open_thread_token(
        thread_handle,
        desired_access,
        open_as_self,
        token_handle as usize,
    )
}

#[inline(always)]
pub unsafe fn nt_terminate_process(process_handle: Handle, exit_status: NtStatus) -> NtStatus {
    libra_nt_terminate_process(process_handle, exit_status)
}

#[inline(always)]
pub unsafe fn nt_terminate_thread(thread_handle: Handle, exit_status: NtStatus) -> NtStatus {
    libra_nt_terminate_thread(thread_handle, exit_status)
}

#[inline(always)]
pub unsafe fn nt_suspend_thread(
    thread_handle: Handle,
    previous_suspend_count: *mut u32,
) -> NtStatus {
    libra_nt_suspend_thread(thread_handle, previous_suspend_count as usize)
}

#[inline(always)]
pub unsafe fn nt_resume_thread(
    thread_handle: Handle,
    previous_suspend_count: *mut u32,
) -> NtStatus {
    libra_nt_resume_thread(thread_handle, previous_suspend_count as usize)
}

#[inline(always)]
pub unsafe fn nt_alert_resume_thread(
    thread_handle: Handle,
    previous_suspend_count: *mut u32,
) -> NtStatus {
    libra_nt_alert_resume_thread(thread_handle, previous_suspend_count as usize)
}

#[inline(always)]
pub unsafe fn nt_get_context_thread(thread_handle: Handle, context: usize) -> NtStatus {
    libra_nt_get_context_thread(thread_handle, context)
}

#[inline(always)]
pub unsafe fn nt_set_context_thread(thread_handle: Handle, context: usize) -> NtStatus {
    libra_nt_set_context_thread(thread_handle, context)
}

#[inline(always)]
pub unsafe fn nt_query_information_process(
    process_handle: Handle,
    class: u32,
    info: usize,
    len: u32,
    ret_len: *mut u32,
) -> NtStatus {
    libra_nt_query_information_process(process_handle, class, info, len, ret_len as usize)
}

#[inline(always)]
pub unsafe fn nt_query_information_thread(
    thread_handle: Handle,
    class: u32,
    info: usize,
    len: u32,
    ret_len: *mut u32,
) -> NtStatus {
    libra_nt_query_information_thread(thread_handle, class, info, len, ret_len as usize)
}

#[inline(always)]
pub unsafe fn nt_query_information_token(
    token_handle: Handle,
    class: u32,
    info: usize,
    len: u32,
    ret_len: *mut u32,
) -> NtStatus {
    libra_nt_query_information_token(token_handle, class, info, len, ret_len as usize)
}

#[inline(always)]
pub unsafe fn nt_query_system_information(
    class: u32,
    info: usize,
    len: u32,
    ret_len: *mut u32,
) -> NtStatus {
    libra_nt_query_system_information(class, info, len, ret_len as usize)
}

#[inline(always)]
pub unsafe fn nt_query_object(
    handle: Handle,
    class: u32,
    info: usize,
    len: u32,
    ret_len: *mut u32,
) -> NtStatus {
    libra_nt_query_object(handle, class, info, len, ret_len as usize)
}

#[inline(always)]
pub unsafe fn nt_query_virtual_memory(
    process_handle: Handle,
    base: usize,
    class: u32,
    info: usize,
    len: usize,
    ret_len: *mut usize,
) -> NtStatus {
    libra_nt_query_virtual_memory(process_handle, base, class, info, len, ret_len as usize)
}

#[inline(always)]
pub unsafe fn nt_allocate_virtual_memory(
    process_handle: Handle,
    base: *mut usize,
    zero_bits: usize,
    region_size: *mut usize,
    alloc_type: u32,
    protect: u32,
) -> NtStatus {
    libra_nt_allocate_virtual_memory(
        process_handle,
        base as usize,
        zero_bits,
        region_size as usize,
        alloc_type,
        protect,
    )
}

#[inline(always)]
pub unsafe fn nt_free_virtual_memory(
    process_handle: Handle,
    base: *mut usize,
    region_size: *mut usize,
    free_type: u32,
) -> NtStatus {
    libra_nt_free_virtual_memory(
        process_handle,
        base as usize,
        region_size as usize,
        free_type,
    )
}

#[inline(always)]
pub unsafe fn nt_protect_virtual_memory(
    process_handle: Handle,
    base: *mut usize,
    region_size: *mut usize,
    new_protect: u32,
    old_protect: *mut u32,
) -> NtStatus {
    libra_nt_protect_virtual_memory(
        process_handle,
        base as usize,
        region_size as usize,
        new_protect,
        old_protect as usize,
    )
}

#[inline(always)]
pub unsafe fn nt_write_virtual_memory(
    process_handle: Handle,
    base: usize,
    buffer: usize,
    len: usize,
    bytes_written: *mut usize,
) -> NtStatus {
    libra_nt_write_virtual_memory(process_handle, base, buffer, len, bytes_written as usize)
}

#[inline(always)]
pub unsafe fn nt_read_virtual_memory(
    process_handle: Handle,
    base: usize,
    buffer: usize,
    len: usize,
    bytes_read: *mut usize,
) -> NtStatus {
    libra_nt_read_virtual_memory(process_handle, base, buffer, len, bytes_read as usize)
}

#[inline(always)]
pub unsafe fn nt_unmap_view_of_section(process_handle: Handle, base: usize) -> NtStatus {
    libra_nt_unmap_view_of_section(process_handle, base)
}

#[inline(always)]
pub unsafe fn nt_map_view_of_section(
    section_handle: Handle,
    process_handle: Handle,
    base: *mut usize,
    zero_bits: usize,
    commit_size: usize,
    section_offset: usize,
    view_size: *mut usize,
    inherit: u32,
    alloc_type: u32,
    protect: u32,
) -> NtStatus {
    libra_nt_map_view_of_section(
        section_handle,
        process_handle,
        base as usize,
        zero_bits,
        commit_size,
        section_offset,
        view_size as usize,
        inherit,
        alloc_type,
        protect,
    )
}

#[inline(always)]
pub unsafe fn nt_create_section(
    section_handle: *mut Handle,
    desired_access: u32,
    object_attributes: usize,
    max_size: usize,
    page_protect: u32,
    alloc_attributes: u32,
    file_handle: Handle,
) -> NtStatus {
    libra_nt_create_section(
        section_handle as usize,
        desired_access,
        object_attributes,
        max_size,
        page_protect,
        alloc_attributes,
        file_handle,
    )
}

#[inline(always)]
pub unsafe fn nt_open_section(
    section_handle: *mut Handle,
    desired_access: u32,
    object_attributes: usize,
) -> NtStatus {
    libra_nt_open_section(section_handle as usize, desired_access, object_attributes)
}

#[inline(always)]
pub unsafe fn nt_create_event(
    event_handle: *mut Handle,
    desired_access: u32,
    object_attributes: usize,
    event_type: u32,
    initial_state: Boolean,
) -> NtStatus {
    libra_nt_create_event(
        event_handle as usize,
        desired_access,
        object_attributes,
        event_type,
        initial_state,
    )
}

#[inline(always)]
pub unsafe fn nt_set_event(event_handle: Handle, previous_state: *mut u32) -> NtStatus {
    libra_nt_set_event(event_handle, previous_state as usize)
}

#[inline(always)]
pub unsafe fn nt_wait_for_single_object(
    handle: Handle,
    alertable: Boolean,
    timeout: *mut LargeInteger,
) -> NtStatus {
    libra_nt_wait_for_single_object(handle, alertable, timeout as usize)
}

#[inline(always)]
pub unsafe fn nt_signal_and_wait_for_single_object(
    signal_handle: Handle,
    wait_handle: Handle,
    alertable: Boolean,
    timeout: *mut LargeInteger,
) -> NtStatus {
    libra_nt_signal_and_wait_for_single_object(
        signal_handle,
        wait_handle,
        alertable,
        timeout as usize,
    )
}

#[inline(always)]
pub unsafe fn nt_create_thread_ex(
    thread_handle: *mut Handle,
    desired_access: u32,
    object_attributes: usize,
    process_handle: Handle,
    start_routine: usize,
    argument: usize,
    create_flags: u32,
    zero_bits: usize,
    stack_size: usize,
    max_stack_size: usize,
    attribute_list: usize,
) -> NtStatus {
    libra_nt_create_thread_ex(
        thread_handle as usize,
        desired_access,
        object_attributes,
        process_handle,
        start_routine,
        argument,
        create_flags,
        zero_bits,
        stack_size,
        max_stack_size,
        attribute_list,
    )
}

#[inline(always)]
pub unsafe fn nt_queue_apc_thread(
    thread_handle: Handle,
    apc_routine: usize,
    arg1: usize,
    arg2: usize,
    arg3: usize,
) -> NtStatus {
    libra_nt_queue_apc_thread(thread_handle, apc_routine, arg1, arg2, arg3)
}

#[inline(always)]
pub unsafe fn nt_duplicate_object(
    source_process: Handle,
    source_handle: Handle,
    target_process: Handle,
    target_handle: *mut Handle,
    desired_access: u32,
    handle_attributes: u32,
    options: u32,
) -> NtStatus {
    libra_nt_duplicate_object(
        source_process,
        source_handle,
        target_process,
        target_handle as usize,
        desired_access,
        handle_attributes,
        options,
    )
}

#[inline(always)]
pub unsafe fn nt_duplicate_token(
    existing_token: Handle,
    desired_access: u32,
    object_attributes: usize,
    effective_only: Boolean,
    token_type: u32,
    new_token: *mut Handle,
) -> NtStatus {
    libra_nt_duplicate_token(
        existing_token,
        desired_access,
        object_attributes,
        effective_only,
        token_type,
        new_token as usize,
    )
}

#[inline(always)]
pub unsafe fn nt_set_information_thread(
    thread_handle: Handle,
    class: u32,
    info: usize,
    len: usize,
) -> NtStatus {
    libra_nt_set_information_thread(thread_handle, class, info, len)
}

#[inline(always)]
pub unsafe fn nt_set_information_process(
    process_handle: Handle,
    class: u32,
    info: usize,
    len: usize,
) -> NtStatus {
    libra_nt_set_information_process(process_handle, class, info, len)
}

#[inline(always)]
pub unsafe fn nt_set_information_virtual_memory(
    process_handle: Handle,
    class: u32,
    num_entries: usize,
    entries: usize,
    buffer: usize,
    buffer_len: usize,
) -> NtStatus {
    libra_nt_set_information_virtual_memory(
        process_handle,
        class,
        num_entries,
        entries,
        buffer,
        buffer_len,
    )
}

#[inline(always)]
pub unsafe fn nt_get_next_thread(
    process_handle: Handle,
    thread_handle: Handle,
    desired_access: u32,
    handle_attributes: u32,
    flags: u32,
    new_thread_handle: *mut Handle,
) -> NtStatus {
    libra_nt_get_next_thread(
        process_handle,
        thread_handle,
        desired_access,
        handle_attributes,
        flags,
        new_thread_handle as usize,
    )
}

#[inline(always)]
pub unsafe fn nt_delay_execution(alertable: Boolean, interval: *mut LargeInteger) -> NtStatus {
    libra_nt_delay_execution(alertable, interval)
}
